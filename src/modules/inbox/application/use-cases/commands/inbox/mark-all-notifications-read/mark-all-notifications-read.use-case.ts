import type { InboxUnitOfWork } from '../../../../ports/outbound/transactions/inbox/inbox-unit-of-work.port.js';
import type { MarkAllNotificationsReadInput } from './mark-all-notifications-read.input.js';
import type { MarkAllNotificationsReadOutput } from './mark-all-notifications-read.output.js';

/** MarkAllNotificationsRead runs against the verified caller scope. */
export class MarkAllNotificationsRead {
  // #region Constructor
  /** Binds the operation’s persistence port. */
  public constructor(private readonly work: InboxUnitOfWork) {}
  // #endregion

  // #region Methods
  /** Executes the operation. */
  public async execute(
    input: MarkAllNotificationsReadInput,
  ): Promise<MarkAllNotificationsReadOutput> {
    return this.work.run(input.organizationId, (store) =>
      store.markAllRead(input.organizationId, input.userId, input.now),
    );
  }
  // #endregion
}
