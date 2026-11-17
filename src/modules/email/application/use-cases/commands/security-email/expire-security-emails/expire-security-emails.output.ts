/**
 * Interface ExpireSecurityEmailsOutput
 *
 * @description
 * What a sweep of the security e-mails settled.
 */
export interface ExpireSecurityEmailsOutput {
  // #region Properties
  /**
   * Property expired
   *
   * @description
   * How many `queued` deliveries became `skipped` for `expired`.
   *
   * @type {number}
   * @readonly
   */
  readonly expired: number;
  // #endregion
}
