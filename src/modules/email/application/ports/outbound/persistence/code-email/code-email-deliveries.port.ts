import type { CodeEmailSkipReason } from '../../../../../domain/value-objects/code-email/code-email-skip-reason.value-object.js';
import type { CodeEmailDeliveryDraft } from '../../../../models/code-email/code-email-delivery-draft.model.js';
import type { CodeEmailContent } from '../../../../models/code-email/code-email-content.model.js';
import type { CodeEmailDelivery } from '../../../../models/code-email/code-email-delivery.model.js';

/**
 * Interface CodeEmailDeliveries
 *
 * @description
 * The send log of the code e-mails (`code_email_deliveries`) and the content of the e-mails not
 * sent yet (`pending_code_emails`). Each call runs in a transaction of the system runner of the
 * kit, and joins the one of the `CodeEmailUnitOfWork` when there is one.
 */
export interface CodeEmailDeliveries {
  // #region Methods
  /**
   * Method record
   *
   * @description
   * Records a delivery, with its content when it is to be sent. A delivery already recorded for
   * the same event is left as it is and nothing is written.
   *
   * @param {CodeEmailDeliveryDraft} draft - The delivery.
   * @param {CodeEmailContent | null} content - The code and the recipient of a `queued` delivery;
   * `null` for a `skipped` one.
   * @returns {Promise<string | null>} The id of the new delivery, or `null` when the event was
   * already recorded.
   */
  record(draft: CodeEmailDeliveryDraft, content: CodeEmailContent | null): Promise<string | null>;

  /**
   * Method find
   *
   * @description
   * Reads a delivery with its content.
   *
   * @param {string} deliveryId - Id of the delivery.
   * @returns {Promise<CodeEmailDelivery | null>} The delivery, or `null` when it does not exist.
   */
  find(deliveryId: string): Promise<CodeEmailDelivery | null>;

  /**
   * Method markSent
   *
   * @description
   * Marks a `queued` delivery `sent`, now, and deletes its content. A delivery in another state
   * is left as it is.
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
   * @param {CodeEmailSkipReason} reason - Why it is not sent.
   * @returns {Promise<void>} Settles once committed.
   */
  markSkipped(deliveryId: string, reason: CodeEmailSkipReason): Promise<void>;

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
   * Settles every delivery still `queued` whose code expired: marks it `skipped` for `expired` and
   * deletes its content, then deletes any content left whose code expired. This catches what no
   * job attempt settles: a job deleted before it started, a last attempt failed by a crash or a
   * timeout. Rows another transaction holds are left to the next sweep.
   *
   * @param {Date} now - The current instant.
   * @returns {Promise<number>} How many deliveries were settled.
   */
  expireStale(now: Date): Promise<number>;
  // #endregion
}
