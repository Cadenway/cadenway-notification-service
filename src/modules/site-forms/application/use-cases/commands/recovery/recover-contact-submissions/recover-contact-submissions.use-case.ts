import type { ContactRecoveryUnitOfWork } from '../../../../ports/outbound/transactions/recovery/contact-recovery-unit-of-work.port.js';

const batchSize = 50;
// The queue drops unstarted jobs after 24 hours from their last due date. Retries can extend that
// date, so recovery reuses the original delivery occurrence key to guard against overlap.
const inactiveHours = 25;

/** Recovers stranded deliveries and expires replay keys without removing submissions. */
export class RecoverContactSubmissions {
  // #region Constructor
  /** Resumes pending mail only when the support mailbox is configured. */
  public constructor(
    private readonly work: ContactRecoveryUnitOfWork,
    private readonly deliveryEnabled: boolean,
  ) {}
  // #endregion

  // #region Methods
  /** Commits receipt expiry separately from any new delivery attempts. */
  public async execute(): Promise<void> {
    await this.work.run((transaction) => transaction.pruneExpiredReceipts(batchSize));
    if (this.deliveryEnabled) {
      await this.work.run((transaction) =>
        transaction.requeueStaleSubmissions(batchSize, inactiveHours),
      );
    }
  }
  // #endregion
}
