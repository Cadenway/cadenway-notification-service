import type { InboxReader } from '../../../../ports/outbound/persistence/inbox/inbox-reader.port.js';
import type { GetUnreadCountInput } from './get-unread-count.input.js';
import type { GetUnreadCountOutput } from './get-unread-count.output.js';

/** GetUnreadCount runs against the verified caller scope. */
export class GetUnreadCount {
  // #region Constructor
  /** Binds the operation’s persistence port. */
  public constructor(private readonly work: InboxReader) {}
  // #endregion

  // #region Methods
  /** Executes the operation. */
  public async execute(input: GetUnreadCountInput): Promise<GetUnreadCountOutput> {
    return this.work.unreadCount(input.organizationId, input.userId);
  }
  // #endregion
}
