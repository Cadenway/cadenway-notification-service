import type { CodeEmailPurpose } from '../../../domain/value-objects/code-email/code-email-purpose.value-object.js';
import type { CodeValidity } from '../../../domain/value-objects/code-email/code-validity.value-object.js';
import type { CodeEmailDeliveryStatus } from './code-email-delivery-status.model.js';
import type { CodeEmailContent } from './code-email-content.model.js';

/**
 * Interface CodeEmailDelivery
 *
 * @description
 * A row of the send log, as the job that sends it reads it.
 */
export interface CodeEmailDelivery {
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
   * Property status
   *
   * @description
   * Where the delivery stands.
   *
   * @type {CodeEmailDeliveryStatus}
   * @readonly
   */
  readonly status: CodeEmailDeliveryStatus;

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
   * Property content
   *
   * @description
   * The code and the recipient while the delivery is `queued`; `null` once they were deleted.
   *
   * @type {CodeEmailContent | null}
   * @readonly
   */
  readonly content: CodeEmailContent | null;
  // #endregion
}
