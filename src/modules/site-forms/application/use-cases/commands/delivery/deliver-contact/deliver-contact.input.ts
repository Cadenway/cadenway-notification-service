/** A bounded attempt of a previously accepted support delivery. */
export interface DeliverContactInput {
  // #region Properties
  /** Stable identifier of the accepted submission. */
  readonly submissionId: string;

  /** Whether the queue will exhaust its configured attempts on failure. */
  readonly lastAttempt: boolean;

  /** Signal from the queue lease and service shutdown. */
  readonly signal: AbortSignal;
  // #endregion
}
