import type { CodeEmailTemplate } from '../../value-objects/code-email/code-email-template.value-object.js';
import type { CodeEmailSkipReason } from '../../value-objects/code-email/code-email-skip-reason.value-object.js';

/**
 * Type CodeEmailDecision
 *
 * @description
 * What to do with an issued code: send the e-mail of a template, or skip it for a reason.
 *
 * @type {{ readonly kind: 'send'; readonly template: CodeEmailTemplate } | { readonly kind: 'skip'; readonly reason: CodeEmailSkipReason }}
 */
export type CodeEmailDecision =
  | { readonly kind: 'send'; readonly template: CodeEmailTemplate }
  | { readonly kind: 'skip'; readonly reason: CodeEmailSkipReason };
