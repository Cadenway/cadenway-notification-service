import type { InboxNotificationSnapshot } from '../../../../../domain/value-objects/inbox/inbox-notification-snapshot.value-object.js';

/** A visibility-filtered page and total active unread count. */
export interface ListInboxOutput {
  // #region Properties
  /** Fields supplied or returned by this operation. */
  readonly items: readonly InboxNotificationSnapshot[];
  readonly nextCursor: string | null;
  readonly unreadCount: number;
  // #endregion
}
