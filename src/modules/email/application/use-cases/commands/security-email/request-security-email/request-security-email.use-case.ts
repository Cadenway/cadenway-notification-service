import { greetingName } from '../../../../../domain/policies/code-email/recipient-name.policy.js';
import {
  decideSecurityEmail,
  noticeWindow,
} from '../../../../../domain/policies/security-email/security-email.policy.js';
import type { SecurityEmailDecision } from '../../../../../domain/policies/security-email/security-email-decision.policy.js';
import { ResetLinkToken } from '../../../../../domain/value-objects/security-email/reset-link-token.value-object.js';
import type { SecurityEmailSkipReason } from '../../../../../domain/value-objects/security-email/security-email-skip-reason.value-object.js';
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
 * Function shownOrNull
 *
 * @description
 * A name of the device as an e-mail may show it: cleaned by `greetingName`, `null` when nothing is
 * left. identity-service reads these names from a `User-Agent`, which the browser writes.
 *
 * @param {string | null} value - The name the event gives.
 * @returns {string | null} The cleaned name, or `null`.
 */
function shownOrNull(value: string | null): string | null {
  const shown: string = value === null ? '' : greetingName(value);
  return shown === '' ? null : shown;
}

/**
 * Function cleanClient
 *
 * @description
 * The browser of an event as the e-mail shows it: every text cleaned so that it neither breaks the
 * layout of the e-mail nor reorders its text, the version of the browser left out.
 *
 * @param {SecurityEmailRequestClient} client - The browser as the event gives it.
 * @returns {SecurityEmailClient} The browser to show.
 */
function cleanClient(client: SecurityEmailRequestClient): SecurityEmailClient {
  return {
    deviceType: greetingName(client.device.type),
    browser: shownOrNull(client.device.browser),
    os: shownOrNull(client.device.os),
    osVersion: shownOrNull(client.device.osVersion),
    ipAddress: greetingName(client.ipAddress),
  };
}

/**
 * Function detailsOf
 *
 * @description
 * The details to keep with the content of the e-mail: the reset token checked and wrapped, the
 * browser cleaned.
 *
 * @param {SecurityEmailRequest} request - What the event asks the e-mail to say.
 * @returns {SecurityEmailDetails} The details.
 * @throws {InvalidResetLinkTokenError} When a reset token is not 32 to 128 URL-safe characters.
 */
function detailsOf(request: SecurityEmailRequest): SecurityEmailDetails {
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
   * recipient and the names of the device are kept as `greetingName` cleans them.
   *
   * @param {RequestSecurityEmailInput} input - The event, mapped.
   * @returns {Promise<RequestSecurityEmailOutput>} What became of it, once committed.
   * @throws {InvalidResetLinkTokenError} When a reset token is not 32 to 128 URL-safe characters.
   * @throws {InvalidSendWindowError} When a reset link does not expire after it was issued and
   * within a day.
   */
  public async execute(input: RequestSecurityEmailInput): Promise<RequestSecurityEmailOutput> {
    const window: SendWindow = windowOf(input.occurredAt, input.request);
    const details: SecurityEmailDetails = detailsOf(input.request);
    const decision: SecurityEmailDecision = decideSecurityEmail(window, this.clock.now());
    const skipReason: SecurityEmailSkipReason | null =
      decision.kind === 'skip' ? decision.reason : null;

    return this.unitOfWork.run(async (): Promise<RequestSecurityEmailOutput> => {
      const deliveryId: string | null = await this.deliveries.record(
        {
          eventId: input.eventId,
          userId: input.userId,
          template: input.request.template,
          language: input.language,
          window,
          skipReason,
        },
        skipReason === null
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
