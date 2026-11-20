import type { RemindersUnitOfWork } from '../../../../ports/outbound/transactions/reminder/reminders-unit-of-work.port.js';
import { requireReminderAccess } from '../../../../models/reminder/reminder-access.model.js';
import type { GetTaskReminderInput } from './get-task-reminder.input.js';
import type { GetTaskReminderOutput } from './get-task-reminder.output.js';

/** GetTaskReminder runs against the caller’s verified scope. */
export class GetTaskReminder {
  // #region Constructor
  /** Binds its transaction or read port. */
  public constructor(private readonly work: RemindersUnitOfWork) {}
  // #endregion

  // #region Methods
  /** Executes the operation. */
  public async execute(input: GetTaskReminderInput): Promise<GetTaskReminderOutput> {
    return this.work.run(input.organizationId, async (store) => {
      const reminder = await store.findPending(input.organizationId, input.userId, input.taskId);
      return requireReminderAccess(reminder, input.organizationId, input.userId, 'visible')
        .snapshot;
    });
  }
  // #endregion
}
