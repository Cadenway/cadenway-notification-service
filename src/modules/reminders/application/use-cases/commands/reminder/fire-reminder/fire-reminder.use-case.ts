import type { RemindersUnitOfWork } from '../../../../ports/outbound/transactions/reminder/reminders-unit-of-work.port.js';
import { ReminderVisibilityUnavailable } from '../../../../models/reminder/reminder-access.model.js';
import type { FireReminderInput } from './fire-reminder.input.js';
import type { FireReminderOutput } from './fire-reminder.output.js';

/** FireReminder runs against the caller’s verified scope. */
export class FireReminder {
  // #region Constructor
  /** Binds its transaction or read port. */
  public constructor(private readonly work: RemindersUnitOfWork) {}
  // #endregion

  // #region Methods
  /** Executes the operation. */
  public async execute(input: FireReminderInput): Promise<FireReminderOutput> {
    return this.work.run(input.organizationId, async (store) => {
      const reminder = await store.findById(input.organizationId, input.userId, input.id, true);
      if (reminder === null) return false;
      const visibility = await store.taskVisibility(
        input.organizationId,
        input.userId,
        reminder.snapshot.taskId,
      );
      if (visibility === 'unavailable') throw new ReminderVisibilityUnavailable();
      if (visibility === 'hidden') return false;
      reminder.requireAccess(input.organizationId, input.userId, true);
      const result = reminder.fireIfDue(input.scheduleVersion, input.now);
      if (result.fact === null) return false;
      await store.save(result.reminder);
      await store.recordDue(result.fact);
      return true;
    });
  }
  // #endregion
}
