import type { QuotaAlertQueue } from '../../../../ports/outbound/jobs/alerts/quota-alert-queue.port.js';
import type { QuotaRecipients } from '../../../../ports/outbound/organization/alerts/quota-recipients.port.js';
import type { PlanQuotaAlertPageInput } from './plan-quota-alert-page.input.js';

/** Plans one page of delivery candidates outside the NATS receipt transaction. */
export class PlanQuotaAlertPage {
  // #region Constructor
  /** Binds current organization authority and the transaction-aware queue. */
  public constructor(
    private readonly recipients: QuotaRecipients,
    private readonly queue: QuotaAlertQueue,
  ) {}
  // #endregion

  // #region Methods
  /** Commits jobs for one page and its continuation after Organization returned. */
  public async execute(
    { organizationId, alert, cursor }: PlanQuotaAlertPageInput,
    signal: AbortSignal,
  ): Promise<void> {
    const page = await this.recipients.list(organizationId, cursor, signal);
    signal.throwIfAborted();
    if (page.nextCursor !== null && page.nextCursor === cursor) {
      throw new Error('Organization did not advance the quota recipient cursor.');
    }
    const userIds = [...new Set(page.items.map((id) => id.toLowerCase()))];
    await this.queue.stagePage(organizationId, alert, userIds, page.nextCursor);
  }
  // #endregion
}
