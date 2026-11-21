/** Identifies an authorized subjectless billing receipt for one recipient. */
export interface RecordBillingNoticeInput {
  // #region Properties
  /** Verified organization that owns the inbox. */
  readonly organizationId: string;

  /** Current authorized account at the delivery check. */
  readonly recipientId: string;

  /** Once-per-recipient identity of the source event. */
  readonly sourceEventId: string;
  // #endregion
}
