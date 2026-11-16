/**
 * Interface ExpireCodeEmailsOutput
 *
 * @description
 * What a sweep settled.
 */
export interface ExpireCodeEmailsOutput {
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
