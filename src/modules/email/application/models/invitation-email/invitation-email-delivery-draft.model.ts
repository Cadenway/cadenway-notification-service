import type { InvitationEmailSkipReason } from '../../../domain/value-objects/invitation-email/invitation-email-skip-reason.value-object.js';
import type { InvitationRole } from '../../../domain/value-objects/invitation-email/invitation-role.value-object.js';
import type { InvitationValidity } from '../../../domain/value-objects/invitation-email/invitation-validity.value-object.js';

/**
 * Interface InvitationEmailDeliveryDraft
 *
 * @description
 * A delivery to record in the send log when an `invitation.issued.v1` event arrives. It names the
 * event and the invitation by their ids and never holds the address nor a name. Its organization
 * is the one of the transaction, never a field of the draft.
 */
export interface InvitationEmailDeliveryDraft {
  // #region Properties
  /**
   * Property eventId
   *
   * @description
   * Id of the event: one delivery per event, whatever the redeliveries.
   *
   * @type {string}
   * @readonly
   */
  readonly eventId: string;

  /**
   * Property invitationId
   *
   * @description
   * Id of the invitation in organization-service, the last segment of the link of the e-mail.
   *
   * @type {string}
   * @readonly
   */
  readonly invitationId: string;

  /**
   * Property invitationVersion
   *
   * @description
   * Version of the invitation: 1 when it was created, one more at each resend.
   *
   * @type {number}
   * @readonly
   */
  readonly invitationVersion: number;

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
   * Property language
   *
   * @description
   * BCP 47 tag the event gives, the default language of the organization.
   *
   * @type {string}
   * @readonly
   */
  readonly language: string;

  /**
   * Property validity
   *
   * @description
   * When the invitation was sent or sent again, and when it stops working.
   *
   * @type {InvitationValidity}
   * @readonly
   */
  readonly validity: InvitationValidity;

  /**
   * Property skipReason
   *
   * @description
   * Why the e-mail is not sent, recorded as `skipped`; `null` to record it `queued`.
   *
   * @type {InvitationEmailSkipReason | null}
   * @readonly
   */
  readonly skipReason: InvitationEmailSkipReason | null;
  // #endregion
}
