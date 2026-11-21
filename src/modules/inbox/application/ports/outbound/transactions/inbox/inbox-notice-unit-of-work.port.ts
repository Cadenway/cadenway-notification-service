import type { InboxNotification } from '../../../../../domain/aggregates/inbox/inbox-notification.aggregate.js';
import type { NotificationCreated } from '../../../../../domain/events/inbox/notification-created.event.js';
import type { InboxSubject } from '../../../../models/inbox/inbox-subject.model.js';

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
    details?: { readonly subject: InboxSubject },
  ): Promise<boolean>;
  // #endregion
}

/** Runs an authorized inbox notice write in the verified tenant transaction. */
export interface InboxNoticeUnitOfWork {
  // #region Methods
  /** Joins the preference check, recipient record and outbox fact in one transaction. */
  run<T>(organizationId: string, work: (store: InboxNoticeStore) => Promise<T>): Promise<T>;
  // #endregion
}
