import type { RemindersUnitOfWork } from '../../../../ports/outbound/transactions/reminder/reminders-unit-of-work.port.js';
import { requireReminderVersion } from '../../../../models/reminder/reminder-access.model.js';
import { loadReminder } from '../../../../services/reminder/load-reminder.service.js';
import type { SnoozeReminderInput } from './snooze-reminder.input.js';
import type { SnoozeReminderOutput } from './snooze-reminder.output.js';

/** SnoozeReminder runs against the caller’s verified scope. */
export class SnoozeReminder {
  // #region Constructor
  /** Binds its transaction or read port. */
  public constructor(private readonly work: RemindersUnitOfWork) {}
  // #endregion

  // #region Methods
  /** Executes the operation. */
  public async execute(input: SnoozeReminderInput): Promise<SnoozeReminderOutput> {
    return this.work.run(input.organizationId, async (store) => {
      const reminder = await loadReminder(
        store,
        input.organizationId,
        input.userId,
        input.id,
        input.authorizedTaskId,
        true,
      );
      requireReminderVersion(input.expectedVersions, reminder.snapshot.version);
      const changed = reminder.snooze(input.remindAt, input.now);
      if (changed !== reminder) await store.save(changed);
      if (changed.snapshot.scheduleVersion !== reminder.snapshot.scheduleVersion)
        await store.schedule(changed);
      return changed.snapshot;
    });
  }
  // #endregion
}
