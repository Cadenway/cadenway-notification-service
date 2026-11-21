/** Contact form data and the gateway-validated operation key. */
export interface SubmitContactInput {
  // #region Properties
  /** Required operation key forwarded by the gateway. */
  readonly idempotencyKey: string;

  /** Validated address for the support Reply-To header. */
  readonly email: string;

  /** Support topic. */
  readonly subject: string;

  /** Original plain text. */
  readonly message: string;
  // #endregion
}
