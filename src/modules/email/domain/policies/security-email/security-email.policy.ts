import type { SecurityEmailTemplate } from '../../value-objects/security-email/security-email-template.value-object.js';
import { SendWindow } from '../../value-objects/security-email/send-window.value-object.js';
import type { SecurityEmailDecision } from './security-email-decision.policy.js';

/**
 * Constant NOTICE_WINDOW_MS
 *
 * @description
 * How long a notice may still leave after its event, in milliseconds: a day.
 *
 * @type {number}
 */
const NOTICE_WINDOW_MS: number = 86_400_000;

/**
 * Function noticeWindow
 *
 * @description
 * The send window of a notice, an e-mail that reports a fact and carries no secret (password
 * changed, address changed, new sign-in, deletion scheduled or cancelled): a day from the fact.
 * The contracts give these e-mails no expiry; a day covers the retries of the job and an outage of
 * the SMTP server, and bounds how long the address, the device and the IP address wait in this
 * service (decision of this service, stated in its `MODULE.md`).
 *
 * @param {Date} occurredAt - When the reported fact happened.
 * @returns {SendWindow} The window, from the fact to a day later.
 * @throws {InvalidSendWindowError} When the instant is invalid.
 */
export function noticeWindow(occurredAt: Date): SendWindow {
  return SendWindow.between(occurredAt, new Date(occurredAt.getTime() + NOTICE_WINDOW_MS));
}

/**
 * Function decideSecurityEmail
 *
 * @description
 * Decides whether a security e-mail leaves. A security e-mail is always sent: no preference, Do not
 * disturb or digest applies (cw-notification-domain, "Sécurité · toujours envoyé" of the Emails
 * artboard). It is skipped only when the event asks for no e-mail this version knows (a `change`
 * of `user.two-step-verification-changed.v1` added later, for which the contract asks a consumer
 * to send nothing), or when its window closed: the contract of `password-reset-link.issued.v1`
 * says a consumer does not send a link whose `expiresAt` has passed, and a notice past its day is
 * no longer sent.
 *
 * @param {SecurityEmailTemplate | null} template - The e-mail the event asks for, or `null` when
 * this version has none for it.
 * @param {SendWindow} window - When the e-mail may leave.
 * @param {Date} now - The current instant.
 * @returns {SecurityEmailDecision} Send, or skip with a reason.
 */
export function decideSecurityEmail(
  template: SecurityEmailTemplate | null,
  window: SendWindow,
  now: Date,
): SecurityEmailDecision {
  if (template === null) {
    return { kind: 'skip', reason: 'change-not-supported' };
  }
  return window.isClosedAt(now) ? { kind: 'skip', reason: 'expired' } : { kind: 'send' };
}
