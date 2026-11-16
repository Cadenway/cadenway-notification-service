import type { OneTimeCode } from '../../../domain/value-objects/code-email/one-time-code.value-object.js';

/**
 * Interface CodeEmailContent
 *
 * @description
 * What only the e-mail itself shows: the code and the recipient. Kept apart from the send log,
 * only while the delivery is `queued`, and deleted as soon as the e-mail is sent, skipped or
 * failed.
 */
export interface CodeEmailContent {
  // #region Properties
  /**
   * Property code
   *
   * @description
   * The single-use code.
   *
   * @type {OneTimeCode}
   * @readonly
   */
  readonly code: OneTimeCode;

  /**
   * Property recipientEmail
   *
   * @description
   * Address to send to. Personal data, never logged.
   *
   * @type {string}
   * @readonly
   */
  readonly recipientEmail: string;

  /**
   * Property recipientName
   *
   * @description
   * Name of the account for the greeting, cleaned by `greetingName`; empty when nothing showable
   * was left.
   *
   * @type {string}
   * @readonly
   */
  readonly recipientName: string;
  // #endregion
}
