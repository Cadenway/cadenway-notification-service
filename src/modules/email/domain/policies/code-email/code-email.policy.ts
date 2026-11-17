import type { CodeEmailPurpose } from '../../value-objects/code-email/code-email-purpose.value-object.js';
import type { CodeEmailTemplate } from '../../value-objects/code-email/code-email-template.value-object.js';
import type { CodeValidity } from '../../value-objects/code-email/code-validity.value-object.js';
import type { CodeEmailDecision } from './code-email-decision.policy.js';

/**
 * Function codeEmailTemplateFor
 *
 * @description
 * The template of a purpose: each purpose of `one-time-code.issued.v1` has its own, named after
 * it. `email-change` sends the code that confirms a new address, valid 15 minutes, to that new
 * address (`POST /v1/me/email-change` of the public auth contract).
 *
 * @param {CodeEmailPurpose} purpose - Purpose of the code.
 * @returns {CodeEmailTemplate} The template.
 */
export function codeEmailTemplateFor(purpose: CodeEmailPurpose): CodeEmailTemplate {
  switch (purpose) {
    case 'email-verification':
      return 'email-verification';
    case 'sign-in':
      return 'sign-in';
    case 'email-change':
      return 'email-change';
  }
}

/**
 * Function decideCodeEmail
 *
 * @description
 * Decides whether the e-mail of an issued code leaves. A security e-mail is always sent: no
 * preference, Do not disturb or digest applies (cw-notification-domain). It is skipped only when
 * its code already expired: the contract of `one-time-code.issued.v1` says a consumer does not
 * send a code whose `expiresAt` has passed.
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
  if (validity.isExpiredAt(now)) {
    return { kind: 'skip', reason: 'expired' };
  }
  return { kind: 'send', template: codeEmailTemplateFor(purpose) };
}
