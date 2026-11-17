import type { InvitationValidity } from '../../value-objects/invitation-email/invitation-validity.value-object.js';
import type { InvitationEmailDecision } from './invitation-email-decision.policy.js';

/**
 * Function decideInvitationEmail
 *
 * @description
 * Decides whether the e-mail of an issued invitation leaves. The contract of
 * `invitation.issued.v1` says that each event is one e-mail, that a consumer sends nothing once
 * `expiresAt` has passed, and that it sends an e-mail only for the latest `version` of an
 * invitation it knows: an event whose version is older than one already received (a late
 * redelivery of the first sending after a resend) is skipped as `superseded`.
 *
 * No preference applies yet: Compte › Notifications ("Invitations et accès") comes with the
 * preferences, and the invitee may have no account.
 *
 * @param {boolean} latestVersion - Whether no later version of the invitation was received.
 * @param {InvitationValidity} validity - When the invitation was sent and stops working.
 * @param {Date} now - The current instant.
 * @returns {InvitationEmailDecision} Send, or skip with a reason.
 */
export function decideInvitationEmail(
  latestVersion: boolean,
  validity: InvitationValidity,
  now: Date,
): InvitationEmailDecision {
  if (!latestVersion) {
    return { kind: 'skip', reason: 'superseded' };
  }
  if (validity.isExpiredAt(now)) {
    return { kind: 'skip', reason: 'expired' };
  }
  return { kind: 'send' };
}
