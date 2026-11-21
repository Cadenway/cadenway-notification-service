import type { InboxNotification } from '../../../../../domain/aggregates/inbox/inbox-notification.aggregate.js';
import type { NotificationCreated } from '../../../../../domain/events/inbox/notification-created.event.js';

interface InboxNoticeStore {
  // #region Methods
  /** Allocates a notification id inside the tenant. */
  newId(organizationId: string): Promise<string>;

  /** Records the receipt and fact if the source event has no effect for this recipient yet. */
  insert(
    organizationId: string,
    recipientId: string,
    sourceEventId: string,
    item: InboxNotification,
    fact: NotificationCreated,
  ): Promise<boolean>;
  // #endregion
}

/** Runs a neutral billing receipt write in the verified Inbox transaction. */
export interface BillingNoticeUnitOfWork {
  // #region Methods
  /** Joins the preference check, recipient record and outbox fact in one transaction. */
  run<T>(organizationId: string, work: (store: InboxNoticeStore) => Promise<T>): Promise<T>;
  // #endregion
}
