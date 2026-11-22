/** Writes one bounded recovery or receipt expiry batch in a system transaction. */
export interface ContactRecoveryTransaction {
  // #region Properties
  /** Requeues stale pending submissions and refreshes their timestamp atomically. */
  readonly requeueStaleSubmissions: (limit: number, inactiveHours: number) => Promise<void>;

  /** Removes expired receipt rows independently of their submission's delivery state. */
  readonly pruneExpiredReceipts: (limit: number) => Promise<void>;

  /** Deletes bounded batches of expired submissions once their replay receipts are gone. */
  readonly pruneExpiredSubmissions: (limit: number) => Promise<void>;
  // #endregion
}
