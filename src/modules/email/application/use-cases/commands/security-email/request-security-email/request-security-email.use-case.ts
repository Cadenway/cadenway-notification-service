import { greetingName } from '../../../../../domain/policies/code-email/recipient-name.policy.js';
import {
  knownDeviceType,
  shownDeviceName,
  shownIpAddress,
  shownVersion,
} from '../../../../../domain/policies/security-email/client-text.policy.js';
import {
  decideSecurityEmail,
  noticeWindow,
} from '../../../../../domain/policies/security-email/security-email.policy.js';
import type { SecurityEmailDecision } from '../../../../../domain/policies/security-email/security-email-decision.policy.js';
import { shownSecurityKeyName } from '../../../../../domain/policies/security-email/security-key-name.policy.js';
import { twoStepEmailTemplate } from '../../../../../domain/policies/security-email/two-step-email.policy.js';
import { ResetLinkToken } from '../../../../../domain/value-objects/security-email/reset-link-token.value-object.js';
import type { SecurityEmailSkipReason } from '../../../../../domain/value-objects/security-email/security-email-skip-reason.value-object.js';
import type { SecurityEmailTemplate } from '../../../../../domain/value-objects/security-email/security-email-template.value-object.js';
import type { TwoStepEmailTemplate } from '../../../../../domain/value-objects/security-email/two-step-email-template.value-object.js';
import { SendWindow } from '../../../../../domain/value-objects/security-email/send-window.value-object.js';
import type { SecurityEmailClient } from '../../../../models/security-email/security-email-client.model.js';
import type { SecurityEmailDetails } from '../../../../models/security-email/security-email-details.model.js';
import type { SecurityEmailRequest } from '../../../../models/security-email/security-email-request.model.js';
import type { SecurityEmailRequestClient } from '../../../../models/security-email/security-email-request-client.model.js';
import type { SecurityEmailQueue } from '../../../../ports/outbound/jobs/security-email/security-email-queue.port.js';
import type { SecurityEmailDeliveries } from '../../../../ports/outbound/persistence/security-email/security-email-deliveries.port.js';
import type { SecurityEmailUnitOfWork } from '../../../../ports/outbound/persistence/security-email/security-email-unit-of-work.port.js';
import type { Clock } from '../../../../ports/outbound/time/code-email/clock.port.js';
import type { RequestSecurityEmailInput } from './request-security-email.input.js';
import type { RequestSecurityEmailOutput } from './request-security-email.output.js';

/**
 * Function cleaned
 *
 * @description
 * A text of the device without controls, format characters or line breaks (`greetingName`),
 * `null` when the event has none.
 *
 * @param {string | null} value - The text the event gives.
 * @returns {string | null} The cleaned text, or `null`.
 */
function cleaned(value: string | null): string | null {
  return value === null ? null : greetingName(value);
}

/**
 * Function cleanClient
 *
 * @description
 * The browser of an event as the e-mail shows it: every text cleaned so that it neither breaks the
 * layout of the e-mail nor reorders its text, then kept only when it looks like a product name, a
 * version or an IP address (`client-text.policy`); an unknown device type reads as `unknown`; the
 * version of the browser is left out.
 *
 * @param {SecurityEmailRequestClient} client - The browser as the event gives it.
 * @returns {SecurityEmailClient} The browser to show.
 */
function cleanClient(client: SecurityEmailRequestClient): SecurityEmailClient {
  return {
    deviceType: knownDeviceType(client.device.type),
    browser: shownDeviceName(cleaned(client.device.browser)),
    os: shownDeviceName(cleaned(client.device.os)),
    osVersion: shownVersion(cleaned(client.device.osVersion)),
    ipAddress: shownIpAddress(greetingName(client.ipAddress)),
  };
}

/**
 * Function twoStepDetailsOf
 *
 * @description
 * The details of the e-mail of a change of the two-step verification, whose template is the one of
 * its `change` (`twoStepEmailTemplate`): the backup codes not used yet for the e-mails that count
 * them, the name of the key cleaned and kept only when it looks like the name of a device
 * (`shownSecurityKeyName`) for the e-mails that name it, the browser cleaned.
 *
 * @param {Extract<SecurityEmailRequest, { readonly template: 'two-step-verification-changed' }>} request - The change.
 * @returns {SecurityEmailDetails | null} The details, or `null` for a change this version has no
 * e-mail for.
 */
function twoStepDetailsOf(
  request: Extract<SecurityEmailRequest, { readonly template: 'two-step-verification-changed' }>,
): SecurityEmailDetails | null {
  const template: TwoStepEmailTemplate | null = twoStepEmailTemplate(request.change);
  switch (template) {
    case null:
      return null;
    case 'two-step-enabled':
    case 'backup-codes-regenerated':
      return {
        template,
        backupCodesRemaining: request.backupCodesRemaining,
        client: cleanClient(request.client),
      };
    case 'two-step-disabled':
    case 'authenticator-app-replaced':
      return { template, client: cleanClient(request.client) };
    case 'security-key-added':
    case 'security-key-removed':
      return {
        template,
        securityKeyName: shownSecurityKeyName(cleaned(request.securityKeyName)),
        client: cleanClient(request.client),
      };
  }
}

/**
 * Function detailsOf
 *
 * @description
 * The details to keep with the content of the e-mail, whose `template` is the e-mail the event
 * asks for: the reset token checked and wrapped, the browser cleaned.
 *
 * @param {SecurityEmailRequest} request - What the event asks the e-mail to say.
 * @returns {SecurityEmailDetails | null} The details, or `null` when the event asks for no e-mail
 * this version knows.
 * @throws {InvalidResetLinkTokenError} When a reset token is not 32 to 128 URL-safe characters.
 */
function detailsOf(request: SecurityEmailRequest): SecurityEmailDetails | null {
  switch (request.template) {
    case 'password-reset':
      return {
        template: request.template,
        token: ResetLinkToken.of(request.token),
        client: cleanClient(request.client),
      };
    case 'password-changed':
      return {
        template: request.template,
        method: request.method,
        closedSessionCount: request.closedSessionCount,
        client: cleanClient(request.client),
      };
    case 'email-changed':
      return {
        template: request.template,
        newEmail: request.newEmail,
        client: cleanClient(request.client),
      };
    case 'new-device':
    case 'deletion-cancelled':
      return { template: request.template, client: cleanClient(request.client) };
    case 'deletion-scheduled':
      return { template: request.template, deleteAt: new Date(request.deleteAt.getTime()) };
    case 'two-step-verification-changed':
      return twoStepDetailsOf(request);
  }
}

/**
 * Function windowOf
 *
 * @description
 * When the e-mail may leave: until the expiry of the link for the reset e-mail, a day for a notice
 * (`noticeWindow`).
 *
 * @param {Date} occurredAt - When the reported fact happened.
 * @param {SecurityEmailRequest} request - What the event asks the e-mail to say.
 * @returns {SendWindow} The window.
 * @throws {InvalidSendWindowError} When the link does not expire after it was issued and within a
 * day.
 */
function windowOf(occurredAt: Date, request: SecurityEmailRequest): SendWindow {
  return request.template === 'password-reset'
    ? SendWindow.between(occurredAt, request.expiresAt)
    : noticeWindow(occurredAt);
}

/**
 * Class RequestSecurityEmail
 *
 * @description
 * Takes a security e-mail in charge: decides whether it leaves (`decideSecurityEmail`), records the
 * delivery in the send log and, when it leaves, keeps its content apart and enqueues its job, in one
 * transaction of the `SecurityEmailUnitOfWork`. Nothing is sent here: the job sends, outside any
 * transaction.
 *
 * Idempotent on the event id: a redelivery that the deduplicator of the kit would not have caught
 * finds the delivery already recorded and writes nothing, so it never enqueues a second e-mail.
 */
export class RequestSecurityEmail {
  // #region Properties
  /**
   * Property unitOfWork
   *
   * @description
   * The transaction of the use case.
   *
   * @type {SecurityEmailUnitOfWork}
   * @readonly
   */
  private readonly unitOfWork: SecurityEmailUnitOfWork;

  /**
   * Property deliveries
   *
   * @description
   * The send log and the pending contents.
   *
   * @type {SecurityEmailDeliveries}
   * @readonly
   */
  private readonly deliveries: SecurityEmailDeliveries;

  /**
   * Property queue
   *
   * @description
   * The queue of the security e-mails.
   *
   * @type {SecurityEmailQueue}
   * @readonly
   */
  private readonly queue: SecurityEmailQueue;

  /**
   * Property clock
   *
   * @description
   * The current instant, to tell a closed window.
   *
   * @type {Clock}
   * @readonly
   */
  private readonly clock: Clock;
  // #endregion

  // #region Constructor
  /**
   * Constructor
   *
   * @description
   * Receives the ports of the use case.
   *
   * @param {SecurityEmailUnitOfWork} unitOfWork - The transaction of the use case.
   * @param {SecurityEmailDeliveries} deliveries - The send log and the pending contents.
   * @param {SecurityEmailQueue} queue - The queue of the security e-mails.
   * @param {Clock} clock - The current instant.
   * @constructor
   */
  public constructor(
    unitOfWork: SecurityEmailUnitOfWork,
    deliveries: SecurityEmailDeliveries,
    queue: SecurityEmailQueue,
    clock: Clock,
  ) {
    this.unitOfWork = unitOfWork;
    this.deliveries = deliveries;
    this.queue = queue;
    this.clock = clock;
  }
  // #endregion

  // #region Methods
  /**
   * Method execute
   *
   * @description
   * Records the security e-mail of an event, and enqueues it when it is to be sent. The name of the
   * recipient, the names of the device and the name of a security key are kept as `greetingName`
   * cleans them. A change of the two-step verification this version has no e-mail for is recorded
   * `skipped` for `change-not-supported`, without template, content or job.
   *
   * @param {RequestSecurityEmailInput} input - The event, mapped.
   * @returns {Promise<RequestSecurityEmailOutput>} What became of it, once committed.
   * @throws {InvalidResetLinkTokenError} When a reset token is not 32 to 128 URL-safe characters.
   * @throws {InvalidSendWindowError} When a reset link does not expire after it was issued and
   * within a day.
   */
  public async execute(input: RequestSecurityEmailInput): Promise<RequestSecurityEmailOutput> {
    const window: SendWindow = windowOf(input.occurredAt, input.request);
    const details: SecurityEmailDetails | null = detailsOf(input.request);
    const template: SecurityEmailTemplate | null = details?.template ?? null;
    const decision: SecurityEmailDecision = decideSecurityEmail(template, window, this.clock.now());
    const skipReason: SecurityEmailSkipReason | null =
      decision.kind === 'skip' ? decision.reason : null;

    return this.unitOfWork.run(async (): Promise<RequestSecurityEmailOutput> => {
      const deliveryId: string | null = await this.deliveries.record(
        {
          eventId: input.eventId,
          userId: input.userId,
          template,
          language: input.language,
          window,
          skipReason,
        },
        skipReason === null && details !== null
          ? {
              recipientEmail: input.recipient.email,
              recipientName: greetingName(input.recipient.name),
              timeZone: input.timeZone,
              details,
            }
          : null,
      );
      if (deliveryId === null) {
        return { outcome: 'duplicate' };
      }
      if (skipReason !== null) {
        return { outcome: 'skipped', deliveryId, reason: skipReason };
      }
      await this.queue.enqueue(deliveryId);
      return { outcome: 'queued', deliveryId };
    });
  }
  // #endregion
}
