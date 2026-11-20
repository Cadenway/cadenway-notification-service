import { requireReminderAccess } from '../../../../models/reminder/reminder-access.model.js';
import type { RemindersUnitOfWork } from '../../../../ports/outbound/transactions/reminder/reminders-unit-of-work.port.js';
import type { GetReminderCandidateInput } from './get-reminder-candidate.input.js';
import type { GetReminderCandidateOutput } from './get-reminder-candidate.output.js';

/** Reads only the caller's reminder-to-task linkage before Gateway authorizes it. */
export class GetReminderCandidate {
  // #region Constructor
  /** Binds the owner-scoped tenant transaction. */
  public constructor(private readonly work: RemindersUnitOfWork) {}
  // #endregion

  // #region Methods
  /** Conceals missing and foreign reminders and includes completed reminders. */
  public execute(input: GetReminderCandidateInput): Promise<GetReminderCandidateOutput> {
    return this.work.run(input.organizationId, async (store) => {
      const reminder = await store.findById(input.organizationId, input.userId, input.id, false);
      const { snapshot } = requireReminderAccess(
        reminder,
        input.organizationId,
        input.userId,
        'visible',
      );
      return { id: snapshot.id, taskId: snapshot.taskId };
    });
  }
  // #endregion
}
