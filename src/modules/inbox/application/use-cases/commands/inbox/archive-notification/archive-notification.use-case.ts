import type { InboxUnitOfWork } from '../../../../ports/outbound/transactions/inbox/inbox-unit-of-work.port.js';
import {
  InboxVersionMismatch,
  requireInboxAccess,
} from '../../../../models/inbox/inbox-access.model.js';
import type { ArchiveNotificationInput } from './archive-notification.input.js';
import type { ArchiveNotificationOutput } from './archive-notification.output.js';

/** ArchiveNotification runs against the verified caller scope. */
export class ArchiveNotification {
  // #region Constructor
  /** Binds the operation’s persistence port. */
  public constructor(private readonly work: InboxUnitOfWork) {}
  // #endregion

  // #region Methods
  /** Executes the operation. */
  public async execute(input: ArchiveNotificationInput): Promise<ArchiveNotificationOutput> {
    return this.work.run(input.organizationId, async (store) => {
      const item = await store.find(input.organizationId, input.userId, input.id, true);
      const visibility = item === null ? 'hidden' : await store.visibility(item);
      const allowed = requireInboxAccess(item, input.organizationId, input.userId, visibility);
      if (
        input.expectedVersion !== undefined &&
        input.expectedVersion !== allowed.snapshot.version
      ) {
        throw new InboxVersionMismatch(allowed.snapshot.version);
      }
      const changed = allowed.archive(input.now);
      if (changed !== allowed) await store.save(changed);
      return changed.snapshot;
    });
  }
  // #endregion
}
