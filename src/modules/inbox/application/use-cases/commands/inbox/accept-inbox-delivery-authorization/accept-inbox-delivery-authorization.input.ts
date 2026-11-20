/** A validated decision from the Task visibility authority. */
export interface AcceptInboxDeliveryAuthorizationInput {
  // #region Properties
  /** Organization in the trusted event envelope. */
  readonly organizationId: string;

  /** The authorization attempt's immutable correlation. */
  readonly attemptId: string;

  /** Disposition without any private Task data. */
  readonly decision: 'permit' | 'deny';

  /** Exclusive deadline set by Task, in UTC epoch milliseconds. */
  readonly validUntil: number;

  /** Canonical decision instant in UTC epoch milliseconds. */
  readonly decidedAt: number;
  // #endregion
}
