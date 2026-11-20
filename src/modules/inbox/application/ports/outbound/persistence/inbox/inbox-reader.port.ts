import type { InboxNotification } from '../../../../../domain/aggregates/inbox/inbox-notification.aggregate.js';

/** Reads recipient-scoped inbox data under current visibility. */
export interface InboxReader {
  // #region Methods
  /** Counts all accessible active unread records. An unavailable authority must fail closed. */
  unreadCount(organizationId: string, userId: string): Promise<number>;

  /** Pages only accessible records and counts unread across the complete authorized set. */
  list(input: {
    readonly organizationId: string;
    readonly userId: string;
    readonly state: 'all' | 'unread' | 'archived';
    readonly cursor: string | null;
    readonly limit: number;
  }): Promise<{
    readonly items: readonly InboxNotification[];
    readonly nextCursor: string | null;
    readonly unreadCount: number;
  }>;
  // #endregion
}
