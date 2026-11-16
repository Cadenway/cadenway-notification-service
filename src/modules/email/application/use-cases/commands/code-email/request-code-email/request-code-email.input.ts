import type { CodeEmailPurpose } from '../../../../../domain/value-objects/code-email/code-email-purpose.value-object.js';

/**
 * Interface RequestCodeEmailInput
 *
 * @description
 * An issued code to e-mail, from a validated `one-time-code.issued.v1` event.
 */
export interface RequestCodeEmailInput {
  // #region Properties
  /**
   * Property eventId
   *
   * @description
   * Id of the event, the key that makes the use case idempotent.
   *
   * @type {string}
   * @readonly
   */
  readonly eventId: string;

  /**
   * Property codeId
   *
   * @description
   * Id of the code in identity-service.
   *
   * @type {string}
   * @readonly
   */
  readonly codeId: string;

  /**
   * Property userId
   *
   * @description
   * Account the code is for.
   *
   * @type {string}
   * @readonly
   */
  readonly userId: string;

  /**
   * Property purpose
   *
   * @description
   * What the code proves.
   *
   * @type {CodeEmailPurpose}
   * @readonly
   */
  readonly purpose: CodeEmailPurpose;

  /**
   * Property code
   *
   * @description
   * The 6 digits. A secret: the use case keeps it with the content of the e-mail only, never in
   * the send log.
   *
   * @type {string}
   * @readonly
   */
  readonly code: string;

  /**
   * Property issuedAt
   *
   * @description
   * When the code was issued (`occurredAt` of the event).
   *
   * @type {Date}
   * @readonly
   */
  readonly issuedAt: Date;

  /**
   * Property expiresAt
   *
   * @description
   * When the code stops working.
   *
   * @type {Date}
   * @readonly
   */
  readonly expiresAt: Date;

  /**
   * Property recipient
   *
   * @description
   * Who receives the e-mail.
   *
   * @type {{ readonly email: string; readonly name: string }}
   * @readonly
   */
  readonly recipient: { readonly email: string; readonly name: string };

  /**
   * Property language
   *
   * @description
   * BCP 47 language tag of the account.
   *
   * @type {string}
   * @readonly
   */
  readonly language: string;
  // #endregion
}
