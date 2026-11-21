import type { QuotaAlert } from '../../../../models/alerts/quota-alert.model.js';

/** A single candidate resolved and authorized afresh by the delivery worker. */
export interface SendQuotaAlertInput {
  // #region Properties
  /** The current organization from the job envelope. */
  readonly organizationId: string;

  /** The candidate account from a page of authorized members. */
  readonly userId: string;

  /** The durable job UUID, stable across all attempts. */
  readonly occurrenceId: string;

  /** The content of the committed crossing. */
  readonly alert: QuotaAlert;
  // #endregion
}
