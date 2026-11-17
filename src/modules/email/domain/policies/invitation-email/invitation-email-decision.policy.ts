import type { InvitationEmailSkipReason } from '../../value-objects/invitation-email/invitation-email-skip-reason.value-object.js';

/**
 * Type InvitationEmailDecision
 *
 * @description
 * What to do with an issued invitation: send its e-mail, or skip it for a reason.
 *
 * @type {{ readonly kind: 'send' } | { readonly kind: 'skip'; readonly reason: InvitationEmailSkipReason }}
 */
export type InvitationEmailDecision =
  { readonly kind: 'send' } | { readonly kind: 'skip'; readonly reason: InvitationEmailSkipReason };
