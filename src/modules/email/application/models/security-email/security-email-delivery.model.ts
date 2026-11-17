import type { SecurityEmailTemplate } from '../../../domain/value-objects/security-email/security-email-template.value-object.js';
import type { SendWindow } from '../../../domain/value-objects/security-email/send-window.value-object.js';
import type { SecurityEmailContent } from './security-email-content.model.js';
import type { SecurityEmailDeliveryStatus } from './security-email-delivery-status.model.js';

/**
 * Interface SecurityEmailDelivery
 *
 * @description
 * A row of the send log of the security e-mails, as the job that sends it reads it.
 */
export interface SecurityEmailDelivery {
  // #region Properties
  /**
   * Property id
   *
   * @description
   * Id of the delivery, the payload and the idempotency key of its job.
   *
   * @type {string}
   * @readonly
   */
  readonly id: string;

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
   * Property status
   *
   * @description
   * Where the delivery stands.
   *
   * @type {SecurityEmailDeliveryStatus}
   * @readonly
   */
  readonly status: SecurityEmailDeliveryStatus;

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
   * Property content
   *
   * @description
   * The recipient and the details while the delivery is `queued`; `null` once they were deleted.
   *
   * @type {SecurityEmailContent | null}
   * @readonly
   */
  readonly content: SecurityEmailContent | null;
  // #endregion
}
