import type { RemindersReader } from '../../../../ports/outbound/persistence/reminder/reminders-reader.port.js';
import type { ListRemindersInput } from './list-reminders.input.js';
import type { ListRemindersOutput } from './list-reminders.output.js';

/** ListReminders runs against the caller’s verified scope. */
export class ListReminders {
  // #region Constructor
  /** Binds its transaction or read port. */
  public constructor(private readonly work: RemindersReader) {}
  // #endregion

  // #region Methods
  /** Executes the operation. */
  public async execute(input: ListRemindersInput): Promise<ListRemindersOutput> {
    const page = await this.work.list(input);
    return { ...page, items: page.items.map((item) => item.snapshot) };
  }
  // #endregion
}
