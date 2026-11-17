import { codeEmailTemplateFor } from '../../../../../domain/policies/code-email/code-email.policy.js';
import type { CodeEmailTemplate } from '../../../../../domain/value-objects/code-email/code-email-template.value-object.js';
import type { Clock } from '../../../../ports/outbound/time/code-email/clock.port.js';
import type { CodeEmailDeliveries } from '../../../../ports/outbound/persistence/code-email/code-email-deliveries.port.js';
import type { CodeEmailDelivery } from '../../../../models/code-email/code-email-delivery.model.js';
import { AttemptAbandonedError } from '../../../../models/code-email/attempt-abandoned-error.model.js';
import type { CodeEmailUnitOfWork } from '../../../../ports/outbound/persistence/code-email/code-email-unit-of-work.port.js';
import type { EmailRenderer } from '../../../../ports/outbound/templates/code-email/email-renderer.port.js';
import type { RenderedEmail } from '../../../../models/code-email/rendered-email.model.js';
import type { EmailSender } from '../../../../ports/outbound/smtp/code-email/email-sender.port.js';
import type { SendCodeEmailInput } from './send-code-email.input.js';
import type { SendCodeEmailOutput } from './send-code-email.output.js';

/**
 * Class SendCodeEmail
 *
 * @description
 * Sends the e-mail of a `queued` delivery: renders it, hands it to the SMTP server outside any
 * transaction, then marks the delivery `sent` and deletes its content in a transaction of the
 * `CodeEmailUnitOfWork`. A security e-mail, so it always offers `List-Unsubscribe` and never its
 * one-click form.
 *
 * Idempotent on the delivery: an attempt that finds the delivery already settled does nothing.
 * Delivery is still at least once: when the server accepted the e-mail but the mark was lost, the
 * next attempt sends it again, with the same `Message-ID`. A code that expired before an attempt
 * is not sent (`skipped`), as the contract of `one-time-code.issued.v1` requires. When rendering or
 * sending fails on the last attempt, the delivery is marked `failed` and its content deleted
 * before the error is rethrown; what no attempt settles, the sweep (`ExpireCodeEmails`) does.
 */
export class SendCodeEmail {
  // #region Properties
  /**
   * Property unitOfWork
   *
   * @description
   * The transaction of each change of the delivery.
   *
   * @type {CodeEmailUnitOfWork}
   * @readonly
   */
  private readonly unitOfWork: CodeEmailUnitOfWork;

  /**
   * Property deliveries
   *
   * @description
   * The send log and the pending contents.
   *
   * @type {CodeEmailDeliveries}
   * @readonly
   */
  private readonly deliveries: CodeEmailDeliveries;

  /**
   * Property renderer
   *
   * @description
   * The compiled templates.
   *
   * @type {EmailRenderer}
   * @readonly
   */
  private readonly renderer: EmailRenderer;

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
   * The current instant, to tell an expired code.
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
   * @param {CodeEmailUnitOfWork} unitOfWork - The transaction of each change.
   * @param {CodeEmailDeliveries} deliveries - The send log and the pending contents.
   * @param {EmailRenderer} renderer - The compiled templates.
   * @param {EmailSender} sender - The SMTP server.
   * @param {Clock} clock - The current instant.
   * @constructor
   */
  public constructor(
    unitOfWork: CodeEmailUnitOfWork,
    deliveries: CodeEmailDeliveries,
    renderer: EmailRenderer,
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
   * @param {SendCodeEmailInput} input - The delivery, whether this is its last attempt, and the
   * signal of the attempt.
   * @returns {Promise<SendCodeEmailOutput>} What the attempt did.
   * @throws {Error} When the e-mail cannot be rendered, the SMTP server is unreachable or refuses
   * it, or the attempt was abandoned, so that the job is tried again.
   */
  public async execute(input: SendCodeEmailInput): Promise<SendCodeEmailOutput> {
    const delivery: CodeEmailDelivery | null = await this.deliveries.find(input.deliveryId);
    if (delivery === null) {
      return { outcome: 'missing' };
    }
    if (delivery.status !== 'queued') {
      return { outcome: 'already-handled', status: delivery.status };
    }
    if (delivery.validity.isExpiredAt(this.clock.now())) {
      await this.unitOfWork.run(() => this.deliveries.markSkipped(delivery.id, 'expired'));
      return { outcome: 'skipped', reason: 'expired' };
    }
    const template: CodeEmailTemplate = codeEmailTemplateFor(delivery.purpose);
    const content: CodeEmailDelivery['content'] = delivery.content;
    if (content === null) {
      await this.unitOfWork.run(() => this.deliveries.markFailed(delivery.id));
      return { outcome: 'failed' };
    }

    try {
      const rendered: RenderedEmail = this.renderer.renderCodeEmail({
        template,
        recipientName: content.recipientName,
        code: content.code,
        validityMinutes: delivery.validity.minutes,
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
    return { outcome: 'sent', template };
  }
  // #endregion
}
