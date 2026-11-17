import type { InvitationRole } from '../../../domain/value-objects/invitation-email/invitation-role.value-object.js';
import type { InvitationValidity } from '../../../domain/value-objects/invitation-email/invitation-validity.value-object.js';
import type { InvitationEmailContent } from './invitation-email-content.model.js';
import type { InvitationEmailDeliveryStatus } from './invitation-email-delivery-status.model.js';

/**
 * Interface InvitationEmailDelivery
 *
 * @description
 * A row of the send log of the invitation e-mails, as the job that sends it reads it.
 */
export interface InvitationEmailDelivery {
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
   * Property invitationId
   *
   * @description
   * Id of the invitation, for the link of the e-mail.
   *
   * @type {string}
   * @readonly
   */
  readonly invitationId: string;

  /**
   * Property role
   *
   * @description
   * The role the invitation proposes.
   *
   * @type {InvitationRole}
   * @readonly
   */
  readonly role: InvitationRole;

  /**
   * Property status
   *
   * @description
   * Where the delivery stands.
   *
   * @type {InvitationEmailDeliveryStatus}
   * @readonly
   */
  readonly status: InvitationEmailDeliveryStatus;

  /**
   * Property validity
   *
   * @description
   * When the invitation was sent and stops working.
   *
   * @type {InvitationValidity}
   * @readonly
   */
  readonly validity: InvitationValidity;

  /**
   * Property content
   *
   * @description
   * The address and the names while the delivery is `queued`; `null` once they were deleted.
   *
   * @type {InvitationEmailContent | null}
   * @readonly
   */
  readonly content: InvitationEmailContent | null;
  // #endregion
}
