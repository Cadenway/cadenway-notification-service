import type { RemindersUnitOfWork } from '../../../../ports/outbound/transactions/reminder/reminders-unit-of-work.port.js';
import { Reminder } from '../../../../../domain/aggregates/reminder/reminder.aggregate.js';
import { requireReminderVersion } from '../../../../models/reminder/reminder-access.model.js';
import type { SetTaskReminderInput } from './set-task-reminder.input.js';
import type { SetTaskReminderOutput } from './set-task-reminder.output.js';

/** SetTaskReminder runs against the caller’s verified scope. */
export class SetTaskReminder {
  // #region Constructor
  /** Binds its transaction or read port. */
  public constructor(private readonly work: RemindersUnitOfWork) {}
  // #endregion

  // #region Methods
  /** Executes the operation. */
  public async execute(input: SetTaskReminderInput): Promise<SetTaskReminderOutput> {
    return this.work.run(input.organizationId, async (store) => {
      await store.lockTaskSlot(input.organizationId, input.userId, input.taskId);
      const previous = await store.findPending(input.organizationId, input.userId, input.taskId);
      requireReminderVersion(input.expectedVersions, previous?.snapshot.version ?? null);
      const next =
        previous === null
          ? Reminder.schedule(
              {
                id: await store.allocateId(),
                organizationId: input.organizationId,
                userId: input.userId,
                taskId: input.taskId,
                remindAt: input.remindAt,
                note: input.note,
              },
              input.now,
            )
          : previous.setSchedule(input.remindAt, input.note, input.now);
      if (next !== previous) {
        await store.save(next);
        if (next.snapshot.scheduleVersion !== previous?.snapshot.scheduleVersion)
          await store.schedule(next);
      }
      return { reminder: next.snapshot, created: previous === null };
    });
  }
  // #endregion
}
