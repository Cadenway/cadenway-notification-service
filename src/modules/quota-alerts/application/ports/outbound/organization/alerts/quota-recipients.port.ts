/** Current authority for the organization users who can receive quota information. */
export interface QuotaRecipients {
  // #region Methods
  /** Reads a single bounded page of owner and administrator IDs. */
  list(
    organizationId: string,
    cursor: string | null,
    signal: AbortSignal,
  ): Promise<{ readonly items: readonly string[]; readonly nextCursor: string | null }>;

  /** Rechecks this account's eligibility immediately before delivery. */
  isEligible(organizationId: string, userId: string, signal: AbortSignal): Promise<boolean>;
  // #endregion
}
