import type { InboxReader } from '../../../../ports/outbound/persistence/inbox/inbox-reader.port.js';
import type { ListInboxInput } from './list-inbox.input.js';
import type { ListInboxOutput } from './list-inbox.output.js';

/** ListInbox runs against the verified caller scope. */
export class ListInbox {
  // #region Constructor
  /** Binds the operation’s persistence port. */
  public constructor(private readonly work: InboxReader) {}
  // #endregion

  // #region Methods
  /** Executes the operation. */
  public async execute(input: ListInboxInput): Promise<ListInboxOutput> {
    const page = await this.work.list(input);
    return { ...page, items: page.items.map((item) => item.snapshot) };
  }
  // #endregion
}
