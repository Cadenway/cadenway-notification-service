/** The committed quota data needed to deliver an administration email. */
export interface QuotaAlert {
  // #region Properties
  /** The Billing event that uniquely identifies this alert. */
  readonly eventId: string;

  /** The counter that crossed its threshold. */
  readonly metric: 'seats' | 'storage';

  /** The crossed percentage declared by Billing. */
  readonly thresholdPercent: 80;

  /** The committed measured value. */
  readonly used: number;

  /** The committed plan limit. */
  readonly limit: number;
  // #endregion
}
