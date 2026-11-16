import type { CodeEmailPurpose } from '../../value-objects/code-email/code-email-purpose.value-object.js';
import type { CodeEmailTemplate } from '../../value-objects/code-email/code-email-template.value-object.js';
import { CodeValidity } from '../../value-objects/code-email/code-validity.value-object.js';
import type { CodeEmailDecision } from './code-email-decision.policy.js';

/**
 * Function codeEmailTemplateFor
 *
 * @description
 * The template of a purpose: `email-verification` and `sign-in` have theirs; `email-change` has
 * none yet, its e-mail comes with address changes.
 *
 * @param {CodeEmailPurpose} purpose - Purpose of the code.
 * @returns {CodeEmailTemplate | null} The template, or `null` when the purpose is not sent yet.
 */
export function codeEmailTemplateFor(purpose: CodeEmailPurpose): CodeEmailTemplate | null {
  switch (purpose) {
    case 'email-verification':
      return 'email-verification';
    case 'sign-in':
      return 'sign-in';
    case 'email-change':
      return null;
  }
}

/**
 * Function decideCodeEmail
 *
 * @description
 * Decides whether the e-mail of an issued code leaves. A security e-mail is always sent: no
 * preference, Do not disturb or digest applies (cw-notification-domain). It is skipped only when
 * no template exists for its purpose, or when its code already expired: the contract of
 * `one-time-code.issued.v1` says a consumer does not send a code whose `expiresAt` has passed.
 *
 * @param {CodeEmailPurpose} purpose - Purpose of the code.
 * @param {CodeValidity} validity - When the code was issued and stops working.
 * @param {Date} now - The current instant.
 * @returns {CodeEmailDecision} Send with a template, or skip with a reason.
 */
export function decideCodeEmail(
  purpose: CodeEmailPurpose,
  validity: CodeValidity,
  now: Date,
): CodeEmailDecision {
  const template: CodeEmailTemplate | null = codeEmailTemplateFor(purpose);
  if (template === null) {
    return { kind: 'skip', reason: 'purpose-not-supported' };
  }
  if (validity.isExpiredAt(now)) {
    return { kind: 'skip', reason: 'expired' };
  }
  return { kind: 'send', template };
}
