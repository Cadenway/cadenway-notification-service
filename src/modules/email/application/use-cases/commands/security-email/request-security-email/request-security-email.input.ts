import type { SecurityEmailRequest } from '../../../../models/security-email/security-email-request.model.js';

/**
 * Interface RequestSecurityEmailInput
 *
 * @description
 * A security e-mail to send, from a validated identity-service event.
 */
export interface RequestSecurityEmailInput {
  // #region Properties
  /**
   * Property eventId
   *
   * @description
   * Id of the event, the key that makes the use case idempotent: one e-mail per event.
   *
   * @type {string}
   * @readonly
   */
  readonly eventId: string;

  /**
   * Property userId
   *
   * @description
   * Account the e-mail is about.
   *
   * @type {string}
   * @readonly
   */
  readonly userId: string;

  /**
   * Property occurredAt
   *
   * @description
   * When the reported fact happened (`occurredAt` of the event): the row "Date" of the e-mail and
   * the start of its send window.
   *
   * @type {Date}
   * @readonly
   */
  readonly occurredAt: Date;

  /**
   * Property recipient
   *
   * @description
   * Who receives the e-mail: the account, or its previous address for `email-changed`.
   *
   * @type {{ readonly email: string; readonly name: string }}
   * @readonly
   */
  readonly recipient: { readonly email: string; readonly name: string };

  /**
   * Property language
   *
   * @description
   * BCP 47 language tag of the account; the e-mail is French whatever it holds.
   *
   * @type {string}
   * @readonly
   */
  readonly language: string;

  /**
   * Property timeZone
   *
   * @description
   * IANA time zone of the account, in which the e-mail shows its dates.
   *
   * @type {string}
   * @readonly
   */
  readonly timeZone: string;

  /**
   * Property request
   *
   * @description
   * What the e-mail says, by template.
   *
   * @type {SecurityEmailRequest}
   * @readonly
   */
  readonly request: SecurityEmailRequest;
  // #endregion
}
