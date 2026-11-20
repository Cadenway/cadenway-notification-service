/** A validated decision from Task. */
export interface AcceptReminderAuthorizationInput {
  // #region Properties
  /** Identifiers and times of the decision. */
  readonly organizationId: string;
  readonly attemptId: string;
  readonly decision: 'permit' | 'deny';
  readonly decidedAt: number;
  readonly validUntil: number;
  // #endregion
}
