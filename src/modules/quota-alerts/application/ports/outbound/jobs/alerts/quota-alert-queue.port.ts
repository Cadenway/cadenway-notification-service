import type { QuotaAlert } from '../../../../models/alerts/quota-alert.model.js';

/** Commits quota alert jobs in the current organization's database. */
export interface QuotaAlertQueue {
  // #region Methods
  /** Stages the first page with the source event receipt. */
  request(organizationId: string, alert: QuotaAlert): Promise<void>;

  /** Stages one page of recipients and its continuation atomically. */
  stagePage(
    organizationId: string,
    alert: QuotaAlert,
    userIds: readonly string[],
    nextCursor: string | null,
  ): Promise<void>;
  // #endregion
}
