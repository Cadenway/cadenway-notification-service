import type { InvitationRole } from '../../../../../domain/value-objects/invitation-email/invitation-role.value-object.js';

/**
 * Interface RequestInvitationEmailInput
 *
 * @description
 * An issued invitation to e-mail, from a validated `invitation.issued.v1` event. Its organization
 * is the one of the current context, the organization of the event, never a field of the input.
 */
export interface RequestInvitationEmailInput {
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
   * Property invitationId
   *
   * @description
   * Id of the invitation.
   *
   * @type {string}
   * @readonly
   */
  readonly invitationId: string;

  /**
   * Property version
   *
   * @description
   * Version of the invitation: 1 at its creation, one more at each resend.
   *
   * @type {number}
   * @readonly
   */
  readonly version: number;

  /**
   * Property latestVersion
   *
   * @description
   * Whether no later version of this invitation was received before, as the version store of the
   * consumer tells it.
   *
   * @type {boolean}
   * @readonly
   */
  readonly latestVersion: boolean;

  /**
   * Property recipientEmail
   *
   * @description
   * Invited address. Personal data: kept with the content of the e-mail only.
   *
   * @type {string}
   * @readonly
   */
  readonly recipientEmail: string;

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
   * Property inviterName
   *
   * @description
   * Full name of the inviter, as the event gives it.
   *
   * @type {string}
   * @readonly
   */
  readonly inviterName: string;

  /**
   * Property organizationName
   *
   * @description
   * Name of the organization, as the event gives it.
   *
   * @type {string}
   * @readonly
   */
  readonly organizationName: string;

  /**
   * Property memberCount
   *
   * @description
   * Members that took a seat when the invitation was sent.
   *
   * @type {number}
   * @readonly
   */
  readonly memberCount: number;

  /**
   * Property issuedAt
   *
   * @description
   * When the invitation was sent or sent again (`occurredAt` of the event).
   *
   * @type {Date}
   * @readonly
   */
  readonly issuedAt: Date;

  /**
   * Property expiresAt
   *
   * @description
   * When the invitation stops working.
   *
   * @type {Date}
   * @readonly
   */
  readonly expiresAt: Date;

  /**
   * Property language
   *
   * @description
   * BCP 47 tag of the event, the default language of the organization; recorded, not used to
   * render: the e-mail is French.
   *
   * @type {string}
   * @readonly
   */
  readonly language: string;
  // #endregion
}
