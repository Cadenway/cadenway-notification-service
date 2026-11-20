/** A validated, tenant-scoped Task decision for one immutable correlation. */
export interface AcceptActivityAuthorizationInput {
  // #region Properties
  /** Values scoped to this operation. */
  readonly organizationId: string;
  readonly attemptId: string;
  readonly decision: 'permit' | 'deny';
  readonly decidedAt: number;
  readonly validUntil: number;
  // #endregion
}
