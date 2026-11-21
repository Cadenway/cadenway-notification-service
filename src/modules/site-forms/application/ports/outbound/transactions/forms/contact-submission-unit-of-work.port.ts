import type { ContactSubmissionTransaction } from './contact-submission-transaction.port.js';

/** Owns a system transaction for contact receipt, submission and job. */
export interface ContactSubmissionUnitOfWork {
  // #region Properties
  /** Commits the whole callback or rolls it back on failure. */
  readonly run: <T>(work: (transaction: ContactSubmissionTransaction) => Promise<T>) => Promise<T>;
  // #endregion
}
