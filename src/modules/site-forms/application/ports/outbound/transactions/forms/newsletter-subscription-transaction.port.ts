/** Operations sharing the durable newsletter signup transaction. */
export interface NewsletterSubscriptionTransaction {
  // #region Properties
  /**
   * Inserts the canonical mailbox if absent. Uniqueness also covers concurrent requests and
   * existing records retain their signup time and subscription state.
   */
  readonly insertIfAbsent: (mailbox: string) => Promise<void>;
  // #endregion
}
