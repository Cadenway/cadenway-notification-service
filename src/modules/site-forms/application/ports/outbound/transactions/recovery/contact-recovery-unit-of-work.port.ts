import type { ContactRecoveryTransaction } from './contact-recovery-transaction.port.js';

/** Runs one Contact recovery operation in a system transaction. */
export interface ContactRecoveryUnitOfWork {
  // #region Properties
  /** Commits the callback's writes together. */
  readonly run: (work: (transaction: ContactRecoveryTransaction) => Promise<void>) => Promise<void>;
  // #endregion
}
