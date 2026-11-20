import type { RemindersUnitOfWork } from '../../../../ports/outbound/transactions/reminder/reminders-unit-of-work.port.js';
import { loadReminder } from '../../../../services/reminder/load-reminder.service.js';
import type { GetReminderInput } from './get-reminder.input.js';
import type { GetReminderOutput } from './get-reminder.output.js';

/** GetReminder runs against the caller’s verified scope. */
export class GetReminder {
  // #region Constructor
  /** Binds its transaction or read port. */
  public constructor(private readonly work: RemindersUnitOfWork) {}
  // #endregion

  // #region Methods
  /** Executes the operation. */
  public async execute(input: GetReminderInput): Promise<GetReminderOutput> {
    return this.work.run(
      input.organizationId,
      async (store) =>
        (
          await loadReminder(
            store,
            input.organizationId,
            input.userId,
            input.id,
            input.authorizedTaskId,
            false,
          )
        ).snapshot,
    );
  }
  // #endregion
}
