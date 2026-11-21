import type { QuotaAlertQueue } from '../../../../ports/outbound/jobs/alerts/quota-alert-queue.port.js';
import type { RequestQuotaAlertInput } from './request-quota-alert.input.js';

/** Persists a retryable delivery plan together with the event receipt. */
export class RequestQuotaAlert {
  // #region Constructor
  /** Binds the transaction-aware queue. */
  public constructor(private readonly queue: QuotaAlertQueue) {}
  // #endregion

  // #region Methods
  /** Stages the first page without calling remote authorities in the receipt transaction. */
  public execute({ organizationId, alert }: RequestQuotaAlertInput): Promise<void> {
    return this.queue.request(organizationId, alert);
  }
  // #endregion
}
