/** Counts from the same transaction as the read-all transition. */
export interface ReadSelectedNotificationsOutput {
  // #region Properties
  /** Number newly marked read. */
  readonly markedRead: number;

  /** Currently unread authorized notifications, including later arrivals. */
  readonly unreadCount: number;
  // #endregion
}
