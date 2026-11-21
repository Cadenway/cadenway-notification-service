import type { QuotaAlert } from '../../../../models/alerts/quota-alert.model.js';

/** One threshold crossing accepted from the Billing event stream. */
export interface RequestQuotaAlertInput {
  // #region Properties
  /** The signed organization of the event. */
  readonly organizationId: string;

  /** The committed crossing. */
  readonly alert: QuotaAlert;
  // #endregion
}
