import { codeEmailTemplateFor } from '../../domain/code-email.js';
import type { CodeEmailSkipReason, CodeEmailTemplate } from '../../domain/code-email.js';
import type { Clock } from '../ports/clock.port.js';
import type {
  CodeEmailDeliveries,
  CodeEmailDelivery,
  CodeEmailDeliveryStatus,
} from '../ports/code-email-deliveries.port.js';
import type { CodeEmailUnitOfWork } from '../ports/code-email-unit-of-work.port.js';
import type { EmailRenderer, RenderedEmail } from '../ports/email-renderer.port.js';
import type { EmailSender } from '../ports/email-sender.port.js';

/**
 * Interface SendCodeEmailInput
 *
 * @description
 * One attempt of the job of a code e-mail.
 */
export interface SendCodeEmailInput {
  // #region Properties
  /**
   * Property deliveryId
   *
   * @description
   * Id of the delivery, the payload of the job.
   *
   * @type {string}
   * @readonly
   */
  readonly deliveryId: string;

  /**
   * Property lastAttempt
   *
   * @description
   * Whether no attempt follows this one: a failure then marks the delivery `failed`.
   *
   * @type {boolean}
   * @readonly
   */
  readonly lastAttempt: boolean;

  /**
   * Property signal
   *
   * @description
   * Aborted when the job system gave up on the attempt (it outlived its time, or the service is
   * stopping): the e-mail is then not handed to the SMTP server, so the retry is the only send.
   *
   * @type {AbortSignal | undefined}
   * @readonly
   */
  readonly signal?: AbortSignal;
  // #endregion
}

/**
 * Type SendCodeEmailResult
 *
 * @description
 * What the attempt did: `sent`, the SMTP server accepted the e-mail; `skipped`, it was not sent
 * for a reason; `failed`, its content was gone and it cannot be sent; `already-handled`, an
 * earlier attempt or the sweep had settled it; `missing`, no such delivery exists.
 *
 * @type {{ readonly outcome: 'sent'; readonly template: CodeEmailTemplate } | { readonly outcome: 'skipped'; readonly reason: CodeEmailSkipReason } | { readonly outcome: 'failed' } | { readonly outcome: 'already-handled'; readonly status: CodeEmailDeliveryStatus } | { readonly outcome: 'missing' }}
 */
export type SendCodeEmailResult =
  | { readonly outcome: 'sent'; readonly template: CodeEmailTemplate }
  | { readonly outcome: 'skipped'; readonly reason: CodeEmailSkipReason }
  | { readonly outcome: 'failed' }
  | { readonly outcome: 'already-handled'; readonly status: CodeEmailDeliveryStatus }
  | { readonly outcome: 'missing' };

/**
 * Class AttemptAbandonedError
 *
 * @description
 * The job system gave up on the attempt before the e-mail was handed to the SMTP server.
 */
export class AttemptAbandonedError extends Error {
  // #region Constructor
  /**
   * Constructor
   *
   * @description
   * Names the error after its class.
   *
   * @constructor
   */
  public constructor() {
    super('The attempt was abandoned before the e-mail was handed to the SMTP server.');
    this.name = 'AttemptAbandonedError';
  }
  // #endregion
}

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
   * @returns {Promise<SendCodeEmailResult>} What the attempt did.
   * @throws {Error} When the e-mail cannot be rendered, the SMTP server is unreachable or refuses
   * it, or the attempt was abandoned, so that the job is tried again.
   */
  public async execute(input: SendCodeEmailInput): Promise<SendCodeEmailResult> {
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
    const template: CodeEmailTemplate | null = codeEmailTemplateFor(delivery.purpose);
    if (template === null) {
      await this.unitOfWork.run(() =>
        this.deliveries.markSkipped(delivery.id, 'purpose-not-supported'),
      );
      return { outcome: 'skipped', reason: 'purpose-not-supported' };
    }
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
        oneClickUnsubscribe: false,
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
