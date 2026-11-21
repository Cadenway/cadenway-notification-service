import type { QuotaAlert } from '../../../../models/alerts/quota-alert.model.js';

/** A worker request to plan a single page of a committed alert. */
export interface PlanQuotaAlertPageInput {
  // #region Properties
  /** The current organization from the job envelope. */
  readonly organizationId: string;

  /** The committed crossing. */
  readonly alert: QuotaAlert;

  /** The opaque continuation, or null for the first page. */
  readonly cursor: string | null;
  // #endregion
}
