import type { RemindersUnitOfWork } from '../../../../ports/outbound/transactions/reminder/reminders-unit-of-work.port.js';
import { requireReminderVersion } from '../../../../models/reminder/reminder-access.model.js';
import { loadReminder } from '../../../../services/reminder/load-reminder.service.js';
import type { DeleteReminderInput } from './delete-reminder.input.js';
import type { DeleteReminderOutput } from './delete-reminder.output.js';

/** DeleteReminder runs against the caller’s verified scope. */
export class DeleteReminder {
  // #region Constructor
  /** Binds its transaction or read port. */
  public constructor(private readonly work: RemindersUnitOfWork) {}
  // #endregion

  // #region Methods
  /** Executes the operation. */
  public async execute(input: DeleteReminderInput): Promise<DeleteReminderOutput> {
    await this.work.run(input.organizationId, async (store) => {
      const reminder = await loadReminder(
        store,
        input.organizationId,
        input.userId,
        input.id,
        input.authorizedTaskId,
        true,
      );
      requireReminderVersion(input.expectedVersions, reminder.snapshot.version);
      await store.remove(reminder);
    });
    return undefined;
  }
  // #endregion
}
