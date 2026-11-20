/** Durable follow-up for one exact reminder authorization attempt. */
export interface ReminderAuthorizationRetry {
  // #region Properties
  /** Routing and scheduling data for this retry. */
  readonly organizationId: string;
  readonly userId: string;
  readonly reminderId: string;
  readonly scheduleVersion: number;
  readonly attemptId: string;
  readonly runAt: number;
  readonly retryCount: number;
  // #endregion
}
