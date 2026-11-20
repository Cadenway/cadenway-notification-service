/** A tenant-owned immutable correlation for one candidate and occurrence generation. */
export interface ActivityAuthorizationAttempt {
  // #region Properties
  /** Values scoped to this operation. */
  readonly id: string;
  readonly organizationId: string;
  readonly expiresAt: number;
  readonly outcome: 'pending' | 'permitted' | 'denied' | 'expired';
  // #endregion
}
