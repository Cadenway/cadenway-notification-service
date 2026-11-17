import type { SecurityEmailSkipReason } from '../../../domain/value-objects/security-email/security-email-skip-reason.value-object.js';
import type { SecurityEmailTemplate } from '../../../domain/value-objects/security-email/security-email-template.value-object.js';
import type { SendWindow } from '../../../domain/value-objects/security-email/send-window.value-object.js';

/**
 * Interface SecurityEmailDeliveryDraft
 *
 * @description
 * A delivery to record in the send log when an event arrives. It names the event and the account by
 * their ids and never holds the address, the device, the IP address or a reset token.
 */
export interface SecurityEmailDeliveryDraft {
  // #region Properties
  /**
   * Property eventId
   *
   * @description
   * Id of the identity-service event: one delivery per event, whatever the redeliveries.
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
   * Property template
   *
   * @description
   * The e-mail to send.
   *
   * @type {SecurityEmailTemplate}
   * @readonly
   */
  readonly template: SecurityEmailTemplate;

  /**
   * Property language
   *
   * @description
   * BCP 47 language tag of the account, as the event gives it; the e-mail is French whatever it
   * holds.
   *
   * @type {string}
   * @readonly
   */
  readonly language: string;

  /**
   * Property window
   *
   * @description
   * When the e-mail may leave.
   *
   * @type {SendWindow}
   * @readonly
   */
  readonly window: SendWindow;

  /**
   * Property skipReason
   *
   * @description
   * Why the e-mail is not sent, recorded as `skipped`; `null` to record it `queued`.
   *
   * @type {SecurityEmailSkipReason | null}
   * @readonly
   */
  readonly skipReason: SecurityEmailSkipReason | null;
  // #endregion
}
