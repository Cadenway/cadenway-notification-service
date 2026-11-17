/**
 * Type InvitationEmailSkipReason
 *
 * @description
 * Why an invitation e-mail is not sent, as the contract of `invitation.issued.v1` requires:
 * `expired`, the invitation stopped working before the e-mail could leave; `superseded`, a later
 * `version` of the same invitation (a resend) is known, and only the latest one is sent.
 *
 * @type {'expired' | 'superseded'}
 */
export type InvitationEmailSkipReason = 'expired' | 'superseded';
