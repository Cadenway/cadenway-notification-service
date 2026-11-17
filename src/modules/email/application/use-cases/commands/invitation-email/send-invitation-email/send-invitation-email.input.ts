/**
 * Interface SendInvitationEmailInput
 *
 * @description
 * One attempt of the job of an invitation e-mail, run in the organization of the job.
 */
export interface SendInvitationEmailInput {
  // #region Properties
  /**
   * Property deliveryId
   *
   * @description
   * Id of the delivery, the payload of the job.
   *
   * @type {string}
   * @readonly
   */
  readonly deliveryId: string;

  /**
   * Property lastAttempt
   *
   * @description
   * Whether no attempt follows this one: a failure then marks the delivery `failed`.
   *
   * @type {boolean}
   * @readonly
   */
  readonly lastAttempt: boolean;

  /**
   * Property signal
   *
   * @description
   * Aborted when the job system gave up on the attempt (it outlived its time, or the service is
   * stopping): the e-mail is then not handed to the SMTP server, so the retry is the only send.
   *
   * @type {AbortSignal | undefined}
   * @readonly
   */
  readonly signal?: AbortSignal;
  // #endregion
}
