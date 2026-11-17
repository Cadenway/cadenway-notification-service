/**
 * Interface InvitationEmailContent
 *
 * @description
 * What only the e-mail itself shows: the invited address and the names and count of its header.
 * Kept apart from the send log, only while the delivery is `queued`, and deleted as soon as the
 * e-mail is sent, skipped or failed.
 */
export interface InvitationEmailContent {
  // #region Properties
  /**
   * Property recipientEmail
   *
   * @description
   * Invited address, where to send the e-mail. Personal data, never logged.
   *
   * @type {string}
   * @readonly
   */
  readonly recipientEmail: string;

  /**
   * Property inviterName
   *
   * @description
   * Full name of the inviter, cleaned by `greetingName`. Personal data, never logged.
   *
   * @type {string}
   * @readonly
   */
  readonly inviterName: string;

  /**
   * Property organizationName
   *
   * @description
   * Name of the organization, cleaned by `greetingName`.
   *
   * @type {string}
   * @readonly
   */
  readonly organizationName: string;

  /**
   * Property memberCount
   *
   * @description
   * Members that took a seat when the invitation was sent ("18 membres"), at least 1.
   *
   * @type {number}
   * @readonly
   */
  readonly memberCount: number;
  // #endregion
}
