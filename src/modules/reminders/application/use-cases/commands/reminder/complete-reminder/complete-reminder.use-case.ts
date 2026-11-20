import type { RemindersUnitOfWork } from '../../../../ports/outbound/transactions/reminder/reminders-unit-of-work.port.js';
import { requireReminderVersion } from '../../../../models/reminder/reminder-access.model.js';
import { loadReminder } from '../../../../services/reminder/load-reminder.service.js';
import type { CompleteReminderInput } from './complete-reminder.input.js';
import type { CompleteReminderOutput } from './complete-reminder.output.js';

/** CompleteReminder runs against the caller’s verified scope. */
export class CompleteReminder {
  // #region Constructor
  /** Binds its transaction or read port. */
  public constructor(private readonly work: RemindersUnitOfWork) {}
  // #endregion

  // #region Methods
  /** Executes the operation. */
  public async execute(input: CompleteReminderInput): Promise<CompleteReminderOutput> {
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
      const changed = reminder.complete(input.now);
      if (changed !== reminder) await store.save(changed);
      return changed.snapshot;
    });
  }
  // #endregion
}
