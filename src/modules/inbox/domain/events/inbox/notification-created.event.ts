/** Recipient-only fact for the application to stage with the new notification. */
export interface NotificationCreated {
  // #region Properties
  /** Identifies the newly created inbox record. */
  readonly notificationId: string;
  readonly organizationId: string;
  readonly recipientId: string;
  readonly createdAt: number;
  // #endregion
}
