/** Position of an examined candidate in descending creation order. */
export interface InboxCandidatePosition {
  // #region Properties
  /** Candidate creation instant. */
  readonly createdAt: Date;

  /** Stable tie-breaker. */
  readonly id: string;
  // #endregion
}
