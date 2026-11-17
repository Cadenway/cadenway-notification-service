/**
 * Type InvitationRole
 *
 * @description
 * The role an invitation proposes, the "Rôle proposé" of the "Invitation" e-mail of the mockup and
 * `role` of `invitation.issued.v1` (`AssignableRole` of asyncapi/organization-service.yaml):
 * `admin` ("Administrateur"), `member` ("Membre") or `guest` ("Invité"). Never `owner`: nobody
 * becomes owner through an invitation.
 *
 * @type {'admin' | 'member' | 'guest'}
 */
export type InvitationRole = 'admin' | 'member' | 'guest';
