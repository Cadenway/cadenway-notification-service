/** Identity of a private inbox candidate. */
export interface GetInboxCandidateInput {
  // #region Properties
  /** Verified tenant. */
  readonly organizationId: string;

  /** Verified account. */
  readonly recipientId: string;

  /** Notification identity. */
  readonly notificationId: string;
  // #endregion
}
