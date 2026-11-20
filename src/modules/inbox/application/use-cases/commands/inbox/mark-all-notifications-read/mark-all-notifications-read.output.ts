/** Changed count and same-transaction accessible unread count. */
export interface MarkAllNotificationsReadOutput {
  // #region Properties
  /** Fields supplied or returned by this operation. */
  readonly markedRead: number;
  readonly unreadCount: number;
  // #endregion
}
