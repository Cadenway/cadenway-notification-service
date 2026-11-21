/** One quota notification email for a currently authorized administrator. */
export interface SendQuotaAlertEmailInput {
  // #region Properties
  /** Stable queue occurrence used by the SMTP adapter. */
  readonly occurrenceId: string;

  /** The current verified email address. */
  readonly address: string;

  /** The counter that reached its threshold. */
  readonly metric: 'seats' | 'storage';

  /** The crossed percentage communicated by Billing. */
  readonly thresholdPercent: number;

  /** The committed usage at the crossing. */
  readonly used: number;

  /** The plan cap at the crossing. */
  readonly limit: number;
  // #endregion
}
