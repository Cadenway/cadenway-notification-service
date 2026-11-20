/** An authorized activity notice. The verified address is used only for SMTP delivery. */
export interface SendActivityNoticeInput {
  // #region Properties
  /** Durable occurrence UUID used for a stable Message-ID across attempts. */
  readonly occurrenceId: string;

  /** Current verified address from Identity. */
  readonly address: string;

  /** Current account language tag. */
  readonly language: string;

  /** Number of activities currently authorized for this account. */
  readonly count: number;

  /** First millisecond at which an included authorization is invalid. */
  readonly validUntil: number;
  // #endregion
}
