import type { SecurityEmailSkipReason } from '../../../../../domain/value-objects/security-email/security-email-skip-reason.value-object.js';
import type { SecurityEmailContent } from '../../../../models/security-email/security-email-content.model.js';
import type { SecurityEmailDelivery } from '../../../../models/security-email/security-email-delivery.model.js';
import type { SecurityEmailDeliveryDraft } from '../../../../models/security-email/security-email-delivery-draft.model.js';

/**
 * Interface SecurityEmailDeliveries
 *
 * @description
 * The send log of the security e-mails (`security_email_deliveries`) and the content of the
 * e-mails not sent yet (`pending_security_emails`). Each call runs in a transaction of the system
 * runner of the kit, and joins the one of the `SecurityEmailUnitOfWork` when there is one.
 */
export interface SecurityEmailDeliveries {
  // #region Methods
  /**
   * Method record
   *
   * @description
   * Records a delivery, with its content when it is to be sent. A delivery already recorded for the
   * same event is left as it is and nothing is written.
   *
   * @param {SecurityEmailDeliveryDraft} draft - The delivery.
   * @param {SecurityEmailContent | null} content - The recipient and the details of a `queued`
   * delivery; `null` for a `skipped` one.
   * @returns {Promise<string | null>} The id of the new delivery, or `null` when the event was
   * already recorded.
   */
  record(
    draft: SecurityEmailDeliveryDraft,
    content: SecurityEmailContent | null,
  ): Promise<string | null>;

  /**
   * Method find
   *
   * @description
   * Reads a delivery with its content.
   *
   * @param {string} deliveryId - Id of the delivery.
   * @returns {Promise<SecurityEmailDelivery | null>} The delivery, or `null` when it does not
   * exist.
   */
  find(deliveryId: string): Promise<SecurityEmailDelivery | null>;

  /**
   * Method markSent
   *
   * @description
   * Marks a `queued` delivery `sent`, now, and deletes its content. A delivery in another state is
   * left as it is.
   *
   * @param {string} deliveryId - Id of the delivery.
   * @returns {Promise<void>} Settles once committed.
   */
  markSent(deliveryId: string): Promise<void>;

  /**
   * Method markSkipped
   *
   * @description
   * Marks a `queued` delivery `skipped` for a reason and deletes its content. A delivery in another
   * state is left as it is.
   *
   * @param {string} deliveryId - Id of the delivery.
   * @param {SecurityEmailSkipReason} reason - Why it is not sent.
   * @returns {Promise<void>} Settles once committed.
   */
  markSkipped(deliveryId: string, reason: SecurityEmailSkipReason): Promise<void>;

  /**
   * Method markFailed
   *
   * @description
   * Marks a `queued` delivery `failed`, after its last attempt, and deletes its content. A delivery
   * in another state is left as it is.
   *
   * @param {string} deliveryId - Id of the delivery.
   * @returns {Promise<void>} Settles once committed.
   */
  markFailed(deliveryId: string): Promise<void>;

  /**
   * Method expireStale
   *
   * @description
   * Settles every delivery still `queued` whose window closed: marks it `skipped` for `expired` and
   * deletes its content, then deletes any content left whose window closed. This catches what no
   * job attempt settles: a job deleted before it started, a last attempt failed by a crash or a
   * timeout. Rows another transaction holds are left to the next sweep.
   *
   * @param {Date} now - The current instant.
   * @returns {Promise<number>} How many deliveries were settled.
   */
  expireStale(now: Date): Promise<number>;
  // #endregion
}
