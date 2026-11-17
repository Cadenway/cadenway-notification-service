import type { InvitationRole } from '../../../domain/value-objects/invitation-email/invitation-role.value-object.js';

/**
 * Interface InvitationEmailMessage
 *
 * @description
 * What an invitation e-mail says, before it is rendered: the facts of the event, without the
 * wording, which the renderer owns (labels, French dates, initials).
 */
export interface InvitationEmailMessage {
  // #region Properties
  /**
   * Property invitationId
   *
   * @description
   * Id of the invitation, the last segment of the link `/invite/<invitationId>`.
   *
   * @type {string}
   * @readonly
   */
  readonly invitationId: string;

  /**
   * Property inviterName
   *
   * @description
   * Full name of the inviter, already cleaned.
   *
   * @type {string}
   * @readonly
   */
  readonly inviterName: string;

  /**
   * Property organizationName
   *
   * @description
   * Name of the organization, already cleaned.
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
   * Property expiresAt
   *
   * @description
   * When the invitation stops working.
   *
   * @type {Date}
   * @readonly
   */
  readonly expiresAt: Date;
  // #endregion
}
