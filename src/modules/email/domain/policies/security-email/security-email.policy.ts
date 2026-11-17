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
 * artboard). It is skipped only when its window closed: the contract of
 * `password-reset-link.issued.v1` says a consumer does not send a link whose `expiresAt` has
 * passed, and a notice past its day is no longer sent.
 *
 * @param {SendWindow} window - When the e-mail may leave.
 * @param {Date} now - The current instant.
 * @returns {SecurityEmailDecision} Send, or skip with a reason.
 */
export function decideSecurityEmail(window: SendWindow, now: Date): SecurityEmailDecision {
  return window.isClosedAt(now) ? { kind: 'skip', reason: 'expired' } : { kind: 'send' };
}
