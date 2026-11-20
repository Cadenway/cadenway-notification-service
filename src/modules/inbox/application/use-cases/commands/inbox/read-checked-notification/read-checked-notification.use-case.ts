import type { InboxSelectionUnitOfWork } from '../../../../ports/outbound/transactions/inbox/inbox-selection-unit-of-work.port.js';
import type { ReadCheckedNotificationInput } from './read-checked-notification.input.js';
import type { ReadCheckedNotificationOutput } from './read-checked-notification.output.js';

/** Marks an owned notification read after Gateway has checked its exact subject. */
export class ReadCheckedNotification {
  // #region Constructor
  /** Binds the write transaction and its clock. */
  public constructor(
    private readonly work: InboxSelectionUnitOfWork,
    private readonly now: () => number,
  ) {}
  // #endregion

  // #region Methods
  /** Performs the linkage, version and idempotent transition in one transaction. */
  public execute(input: ReadCheckedNotificationInput): Promise<ReadCheckedNotificationOutput> {
    return this.work.run(input.organizationId, (store) =>
      store.change(
        input.organizationId,
        input.recipientId,
        input.notificationId,
        input.subject,
        'read',
        input.expectedVersions,
        this.now(),
      ),
    );
  }
  // #endregion
}
