import type { NewsletterSubscriptionTransaction } from './newsletter-subscription-transaction.port.js';

/** Owns a system transaction for a public newsletter signup. */
export interface NewsletterSubscriptionUnitOfWork {
  // #region Properties
  /** Commits the callback or rolls it back on failure. */
  readonly run: <T>(
    work: (transaction: NewsletterSubscriptionTransaction) => Promise<T>,
  ) => Promise<T>;
  // #endregion
}
