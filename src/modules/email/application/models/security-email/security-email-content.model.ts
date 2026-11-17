import type { SecurityEmailDetails } from './security-email-details.model.js';

/**
 * Interface SecurityEmailContent
 *
 * @description
 * What only the e-mail itself shows: the recipient, the time zone of its dates and its details
 * (the device, the IP address, a new address, a reset token). Kept apart from the send log, only
 * while the delivery is `queued`, and deleted as soon as the e-mail is sent, skipped or failed.
 */
export interface SecurityEmailContent {
  // #region Properties
  /**
   * Property recipientEmail
   *
   * @description
   * Address to send to: the address of the account, or the previous one for `email-changed`.
   * Personal data, never logged.
   *
   * @type {string}
   * @readonly
   */
  readonly recipientEmail: string;

  /**
   * Property recipientName
   *
   * @description
   * Name of the account, cleaned by `greetingName`, for the `To` header; empty to write to the
   * address alone.
   *
   * @type {string}
   * @readonly
   */
  readonly recipientName: string;

  /**
   * Property timeZone
   *
   * @description
   * IANA time zone of the account, as the event gives it, in which the e-mail shows its dates; an
   * unknown one reads as Paris when the e-mail is rendered.
   *
   * @type {string}
   * @readonly
   */
  readonly timeZone: string;

  /**
   * Property details
   *
   * @description
   * What the template shows besides the recipient and the date.
   *
   * @type {SecurityEmailDetails}
   * @readonly
   */
  readonly details: SecurityEmailDetails;
  // #endregion
}
