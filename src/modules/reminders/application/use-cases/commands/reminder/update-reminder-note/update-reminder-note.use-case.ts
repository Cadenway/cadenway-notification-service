import type { RemindersUnitOfWork } from '../../../../ports/outbound/transactions/reminder/reminders-unit-of-work.port.js';
import { requireReminderVersion } from '../../../../models/reminder/reminder-access.model.js';
import { loadReminder } from '../../../../services/reminder/load-reminder.service.js';
import type { UpdateReminderNoteInput } from './update-reminder-note.input.js';
import type { UpdateReminderNoteOutput } from './update-reminder-note.output.js';

/** UpdateReminderNote runs against the caller’s verified scope. */
export class UpdateReminderNote {
  // #region Constructor
  /** Binds its transaction or read port. */
  public constructor(private readonly work: RemindersUnitOfWork) {}
  // #endregion

  // #region Methods
  /** Executes the operation. */
  public async execute(input: UpdateReminderNoteInput): Promise<UpdateReminderNoteOutput> {
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
      const changed = reminder.changeNote(input.note);
      if (changed !== reminder) await store.save(changed);
      return changed.snapshot;
    });
  }
  // #endregion
}
