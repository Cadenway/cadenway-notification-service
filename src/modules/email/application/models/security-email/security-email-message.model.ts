import type { SecurityEmailDetails } from './security-email-details.model.js';

/**
 * Interface SecurityEmailMessage
 *
 * @description
 * What a security e-mail says, before it is rendered.
 */
export interface SecurityEmailMessage {
  // #region Properties
  /**
   * Property recipientEmail
   *
   * @description
   * Address the e-mail goes to, which the reset e-mail names ("Une réinitialisation a été demandée
   * pour …").
   *
   * @type {string}
   * @readonly
   */
  readonly recipientEmail: string;

  /**
   * Property occurredAt
   *
   * @description
   * When the reported fact happened: the row "Date".
   *
   * @type {Date}
   * @readonly
   */
  readonly occurredAt: Date;

  /**
   * Property validityMinutes
   *
   * @description
   * Length of the send window in whole minutes: how long a reset link works ("30").
   *
   * @type {number}
   * @readonly
   */
  readonly validityMinutes: number;

  /**
   * Property timeZone
   *
   * @description
   * IANA time zone of the dates, as the event gives it; an unknown one reads as Paris.
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
