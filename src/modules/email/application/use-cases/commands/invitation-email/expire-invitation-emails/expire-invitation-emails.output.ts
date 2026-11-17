/**
 * Interface ExpireInvitationEmailsOutput
 *
 * @description
 * What a sweep of the invitation e-mails settled.
 */
export interface ExpireInvitationEmailsOutput {
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
