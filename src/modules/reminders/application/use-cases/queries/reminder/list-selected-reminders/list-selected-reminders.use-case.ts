import type { ReminderCandidatesReader } from '../../../../ports/outbound/persistence/reminder/reminder-candidates-reader.port.js';
import type { ListSelectedRemindersInput } from './list-selected-reminders.input.js';
import type { ListSelectedRemindersOutput } from './list-selected-reminders.output.js';

/** Fetches only the exact task and reminder pairs checked by the gateway. */
export class ListSelectedReminders {
  // #region Constructor
  /** Binds the repeatable-read candidate query. */
  public constructor(private readonly reader: ReminderCandidatesReader) {}
  // #endregion

  // #region Methods
  /** Verifies the generation even for an empty list of pairs. */
  public async execute(input: ListSelectedRemindersInput): Promise<ListSelectedRemindersOutput> {
    const selected = await this.reader.selected(input);
    return selected.map((reminder) => reminder.snapshot);
  }
  // #endregion
}
