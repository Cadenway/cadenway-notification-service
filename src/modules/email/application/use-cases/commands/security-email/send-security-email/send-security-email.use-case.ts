import { AttemptAbandonedError } from '../../../../models/code-email/attempt-abandoned-error.model.js';
import type { RenderedEmail } from '../../../../models/code-email/rendered-email.model.js';
import type { SecurityEmailContent } from '../../../../models/security-email/security-email-content.model.js';
import type { SecurityEmailDelivery } from '../../../../models/security-email/security-email-delivery.model.js';
import type { SecurityEmailDeliveries } from '../../../../ports/outbound/persistence/security-email/security-email-deliveries.port.js';
import type { SecurityEmailUnitOfWork } from '../../../../ports/outbound/persistence/security-email/security-email-unit-of-work.port.js';
import type { EmailSender } from '../../../../ports/outbound/smtp/code-email/email-sender.port.js';
import type { SecurityEmailRenderer } from '../../../../ports/outbound/templates/security-email/security-email-renderer.port.js';
import type { Clock } from '../../../../ports/outbound/time/code-email/clock.port.js';
import type { SendSecurityEmailInput } from './send-security-email.input.js';
import type { SendSecurityEmailOutput } from './send-security-email.output.js';

/**
 * Class SendSecurityEmail
 *
 * @description
 * Sends the e-mail of a `queued` security delivery: renders it, hands it to the SMTP server outside
 * any transaction, then marks the delivery `sent` and deletes its content in a transaction of the
 * `SecurityEmailUnitOfWork`. A security e-mail cannot be turned off, so it carries no
 * `List-Unsubscribe` (cw-email-templates).
 *
 * Idempotent on the delivery: an attempt that finds the delivery already settled does nothing.
 * Delivery is still at least once: when the server accepted the e-mail but the mark was lost, the
 * next attempt sends it again, with the same `Message-ID`. An e-mail whose window closed before an
 * attempt is not sent (`skipped`): a reset link that stopped working, as the contract of
 * `password-reset-link.issued.v1` requires, or a notice more than a day old. When rendering or
 * sending fails on the last attempt, the delivery is marked `failed` and its content deleted before
 * the error is rethrown; what no attempt settles, the sweep (`ExpireSecurityEmails`) does.
 */
export class SendSecurityEmail {
  // #region Properties
  /**
   * Property unitOfWork
   *
   * @description
   * The transaction of each change of the delivery.
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
   * Property renderer
   *
   * @description
   * The compiled templates.
   *
   * @type {SecurityEmailRenderer}
   * @readonly
   */
  private readonly renderer: SecurityEmailRenderer;

  /**
   * Property sender
   *
   * @description
   * The SMTP server.
   *
   * @type {EmailSender}
   * @readonly
   */
  private readonly sender: EmailSender;

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
   * @param {SecurityEmailUnitOfWork} unitOfWork - The transaction of each change.
   * @param {SecurityEmailDeliveries} deliveries - The send log and the pending contents.
   * @param {SecurityEmailRenderer} renderer - The compiled templates.
   * @param {EmailSender} sender - The SMTP server.
   * @param {Clock} clock - The current instant.
   * @constructor
   */
  public constructor(
    unitOfWork: SecurityEmailUnitOfWork,
    deliveries: SecurityEmailDeliveries,
    renderer: SecurityEmailRenderer,
    sender: EmailSender,
    clock: Clock,
  ) {
    this.unitOfWork = unitOfWork;
    this.deliveries = deliveries;
    this.renderer = renderer;
    this.sender = sender;
    this.clock = clock;
  }
  // #endregion

  // #region Methods
  /**
   * Method execute
   *
   * @description
   * Runs one attempt of the job of a delivery.
   *
   * @param {SendSecurityEmailInput} input - The delivery, whether this is its last attempt, and
   * the signal of the attempt.
   * @returns {Promise<SendSecurityEmailOutput>} What the attempt did.
   * @throws {Error} When the e-mail cannot be rendered, the SMTP server is unreachable or refuses
   * it, or the attempt was abandoned, so that the job is tried again.
   */
  public async execute(input: SendSecurityEmailInput): Promise<SendSecurityEmailOutput> {
    const delivery: SecurityEmailDelivery | null = await this.deliveries.find(input.deliveryId);
    if (delivery === null) {
      return { outcome: 'missing' };
    }
    if (delivery.status !== 'queued') {
      return { outcome: 'already-handled', status: delivery.status };
    }
    if (delivery.window.isClosedAt(this.clock.now())) {
      await this.unitOfWork.run(() => this.deliveries.markSkipped(delivery.id, 'expired'));
      return { outcome: 'skipped', reason: 'expired' };
    }
    const content: SecurityEmailContent | null = delivery.content;
    if (content === null) {
      await this.unitOfWork.run(() => this.deliveries.markFailed(delivery.id));
      return { outcome: 'failed' };
    }

    try {
      const rendered: RenderedEmail = this.renderer.renderSecurityEmail({
        recipientEmail: content.recipientEmail,
        occurredAt: delivery.window.occurredAt,
        validityMinutes: delivery.window.minutes,
        timeZone: content.timeZone,
        details: content.details,
      });
      if (input.signal?.aborted === true) {
        throw new AttemptAbandonedError();
      }
      await this.sender.send({
        ...rendered,
        id: delivery.id,
        to: { address: content.recipientEmail, name: content.recipientName },
        unsubscribe: false,
      });
    } catch (error) {
      if (input.lastAttempt) {
        await this.unitOfWork.run(() => this.deliveries.markFailed(delivery.id));
      }
      throw error;
    }
    await this.unitOfWork.run(() => this.deliveries.markSent(delivery.id));
    return { outcome: 'sent', template: content.details.template };
  }
  // #endregion
}
