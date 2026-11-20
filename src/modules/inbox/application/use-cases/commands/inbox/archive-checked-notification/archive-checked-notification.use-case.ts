import type { InboxSelectionUnitOfWork } from '../../../../ports/outbound/transactions/inbox/inbox-selection-unit-of-work.port.js';
import type { ArchiveCheckedNotificationInput } from './archive-checked-notification.input.js';
import type { ArchiveCheckedNotificationOutput } from './archive-checked-notification.output.js';

/** Archives an owned notification after Gateway has checked its exact subject. */
export class ArchiveCheckedNotification {
  // #region Constructor
  /** Binds the write transaction and its clock. */
  public constructor(
    private readonly work: InboxSelectionUnitOfWork,
    private readonly now: () => number,
  ) {}
  // #endregion

  // #region Methods
  /** Performs the linkage, version and idempotent transition in one transaction. */
  public execute(
    input: ArchiveCheckedNotificationInput,
  ): Promise<ArchiveCheckedNotificationOutput> {
    return this.work.run(input.organizationId, (store) =>
      store.change(
        input.organizationId,
        input.recipientId,
        input.notificationId,
        input.subject,
        'archive',
        input.expectedVersions,
        this.now(),
      ),
    );
  }
  // #endregion
}
