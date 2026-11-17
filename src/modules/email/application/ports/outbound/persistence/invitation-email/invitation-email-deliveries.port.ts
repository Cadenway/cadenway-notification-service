import type { InvitationEmailSkipReason } from '../../../../../domain/value-objects/invitation-email/invitation-email-skip-reason.value-object.js';
import type { InvitationEmailContent } from '../../../../models/invitation-email/invitation-email-content.model.js';
import type { InvitationEmailDeliveryDraft } from '../../../../models/invitation-email/invitation-email-delivery-draft.model.js';
import type { InvitationEmailDelivery } from '../../../../models/invitation-email/invitation-email-delivery.model.js';

/**
 * Interface InvitationEmailDeliveries
 *
 * @description
 * The send log of the invitation e-mails (`invitation_email_deliveries`) and the content of the
 * e-mails not sent yet (`pending_invitation_emails`), both owned by an organization. Every call
 * but `expireStale` runs in a tenant transaction of the organization of the current context, and
 * joins the one of the `InvitationEmailUnitOfWork` when there is one; `expireStale` crosses
 * organizations in a system transaction and joins the one of the
 * `InvitationEmailSweepUnitOfWork`.
 */
export interface InvitationEmailDeliveries {
  // #region Methods
  /**
   * Method record
   *
   * @description
   * Records a delivery in the organization of the transaction, with its content when it is to be
   * sent. A delivery already recorded for the same event is left as it is and nothing is written.
   *
   * @param {InvitationEmailDeliveryDraft} draft - The delivery.
   * @param {InvitationEmailContent | null} content - The address and names of a `queued`
   * delivery; `null` for a `skipped` one.
   * @returns {Promise<string | null>} The id of the new delivery, or `null` when the event was
   * already recorded.
   */
  record(
    draft: InvitationEmailDeliveryDraft,
    content: InvitationEmailContent | null,
  ): Promise<string | null>;

  /**
   * Method supersede
   *
   * @description
   * Marks `skipped` for `superseded` every `queued` delivery of an invitation for a version older
   * than the given one, and deletes their contents: only the latest version is sent.
   *
   * @param {string} invitationId - Id of the invitation.
   * @param {number} version - The latest version received.
   * @returns {Promise<number>} How many deliveries were superseded.
   */
  supersede(invitationId: string, version: number): Promise<number>;

  /**
   * Method find
   *
   * @description
   * Reads a delivery of the organization of the transaction, with its content.
   *
   * @param {string} deliveryId - Id of the delivery.
   * @returns {Promise<InvitationEmailDelivery | null>} The delivery, or `null` when it does not
   * exist in that organization.
   */
  find(deliveryId: string): Promise<InvitationEmailDelivery | null>;

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
   * @param {InvitationEmailSkipReason} reason - Why it is not sent.
   * @returns {Promise<void>} Settles once committed.
   */
  markSkipped(deliveryId: string, reason: InvitationEmailSkipReason): Promise<void>;

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
   * In every organization, settles the deliveries still `queued` whose invitation expired: marks
   * them `skipped` for `expired` and deletes their contents, then deletes any content left whose
   * invitation expired. This catches what no job attempt settles: a last attempt failed by a crash.
   * Rows another transaction holds are left to the next sweep.
   *
   * @param {Date} now - The current instant.
   * @returns {Promise<number>} How many deliveries were settled.
   */
  expireStale(now: Date): Promise<number>;
  // #endregion
}
