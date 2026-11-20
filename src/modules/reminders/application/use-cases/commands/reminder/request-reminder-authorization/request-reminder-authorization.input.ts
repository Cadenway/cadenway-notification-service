/** Identifiers and deadlines for a scheduled reminder authorization attempt. */
export interface RequestReminderAuthorizationInput {
  // #region Properties
  /** Identifiers and deadlines of the attempt. */
  readonly organizationId: string;
  readonly userId: string;
  readonly reminderId: string;
  readonly scheduleVersion: number;
  readonly expiresAt: number;

  /** Zero for the first job, increasing for each expiration follow-up. */
  readonly retryCount: number;

  /** Null for the initial job, otherwise the attempt whose expiry triggered this retry. */
  readonly previousAttemptId: string | null;
  // #endregion
}
