import type { SecurityEmailSkipReason } from '../../value-objects/security-email/security-email-skip-reason.value-object.js';

/**
 * Type SecurityEmailDecision
 *
 * @description
 * What to do with a security e-mail: send it, or skip it for a reason.
 *
 * @type {{ readonly kind: 'send' } | { readonly kind: 'skip'; readonly reason: SecurityEmailSkipReason }}
 */
export type SecurityEmailDecision =
  { readonly kind: 'send' } | { readonly kind: 'skip'; readonly reason: SecurityEmailSkipReason };
