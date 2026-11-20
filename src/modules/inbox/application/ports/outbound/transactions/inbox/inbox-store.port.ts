import type { InboxNotification } from '../../../../../domain/aggregates/inbox/inbox-notification.aggregate.js';

/** Tenant transaction with authoritative visibility decisions for recipient-owned records. */
export interface InboxStore {
  // #region Methods
  /** Loads only the recipient's item and optionally holds its write lock. */
  find(
    organizationId: string,
    userId: string,
    id: string,
    lock: boolean,
  ): Promise<InboxNotification | null>;

  /** Resolves current visibility, including an explicit unavailable outcome. */
  visibility(item: InboxNotification): Promise<'visible' | 'hidden' | 'unavailable'>;

  /** Persists an authorized changed aggregate in the current transaction. */
  save(item: InboxNotification): Promise<void>;

  /** Marks visible active unread records at the snapshot instant and returns same-transaction counts. */
  markAllRead(
    organizationId: string,
    userId: string,
    now: number,
  ): Promise<{ readonly markedRead: number; readonly unreadCount: number }>;
  // #endregion
}
