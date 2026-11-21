/** One neutral quota receipt addressed to an account in the verified organization. */
export interface SendQuotaInboxAlertInput {
  // #region Properties
  /** Verified organization from the delivery job. */
  readonly organizationId: string;

  /** Recipient account to recheck before delivery. */
  readonly recipientId: string;

  /** Billing event identity for Inbox deduplication. */
  readonly sourceEventId: string;
  // #endregion
}
