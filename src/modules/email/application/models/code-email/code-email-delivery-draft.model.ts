import type { CodeEmailPurpose } from '../../../domain/value-objects/code-email/code-email-purpose.value-object.js';
import type { CodeEmailSkipReason } from '../../../domain/value-objects/code-email/code-email-skip-reason.value-object.js';
import type { CodeValidity } from '../../../domain/value-objects/code-email/code-validity.value-object.js';

/**
 * Interface CodeEmailDeliveryDraft
 *
 * @description
 * A delivery to record in the send log when an event arrives. It names the event, the code and the
 * account by their ids and never holds the code nor the address.
 */
export interface CodeEmailDeliveryDraft {
  // #region Properties
  /**
   * Property eventId
   *
   * @description
   * Id of the `one-time-code.issued.v1` event: one delivery per event, whatever the redeliveries.
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
   * What the code proves, which decides the template.
   *
   * @type {CodeEmailPurpose}
   * @readonly
   */
  readonly purpose: CodeEmailPurpose;

  /**
   * Property language
   *
   * @description
   * BCP 47 language tag of the account, as the event gives it.
   *
   * @type {string}
   * @readonly
   */
  readonly language: string;

  /**
   * Property validity
   *
   * @description
   * When the code was issued and stops working.
   *
   * @type {CodeValidity}
   * @readonly
   */
  readonly validity: CodeValidity;

  /**
   * Property skipReason
   *
   * @description
   * Why the e-mail is not sent, recorded as `skipped`; `null` to record it `queued`.
   *
   * @type {CodeEmailSkipReason | null}
   * @readonly
   */
  readonly skipReason: CodeEmailSkipReason | null;
  // #endregion
}
