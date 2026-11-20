/** Maximum number of authorization requests for one recipient and source, including the first. */
export const INBOX_AUTHORIZATION_MAX_ATTEMPTS: number = 10;

/** Time for Task to decide one correlation. */
export const INBOX_AUTHORIZATION_WINDOW_MS: number = 30_000;

/** Durable expiration check for one currently bound Inbox authorization correlation. */
export interface InboxAuthorizationRetry {
  // #region Properties
  /** Tenant verified by the job runtime. */
  readonly organizationId: string;

  /** Correlation whose exclusive deadline triggers this check. */
  readonly attemptId: string;

  /** The exclusive deadline, and the earliest instant the job can run. */
  readonly runAt: number;

  /** Number of requests issued so far, including the first one. */
  readonly retryCount: number;
  // #endregion
}
