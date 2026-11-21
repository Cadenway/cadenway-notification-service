import type { RenderedEmail } from '../../../../models/code-email/rendered-email.model.js';

/** Renders the breached quota from the Billing crossing snapshot. */
export interface QuotaAlertRenderer {
  // #region Methods
  /** Formats the usage and limit without organization or account details. */
  renderQuotaAlert(
    metric: 'seats' | 'storage',
    thresholdPercent: number,
    used: number,
    limit: number,
  ): RenderedEmail;
  // #endregion
}
