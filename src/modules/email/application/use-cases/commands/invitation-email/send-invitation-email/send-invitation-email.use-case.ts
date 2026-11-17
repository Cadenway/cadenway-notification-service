import { AttemptAbandonedError } from '../../../../models/code-email/attempt-abandoned-error.model.js';
import type { RenderedEmail } from '../../../../models/code-email/rendered-email.model.js';
import type { InvitationEmailDelivery } from '../../../../models/invitation-email/invitation-email-delivery.model.js';
import type { InvitationEmailDeliveries } from '../../../../ports/outbound/persistence/invitation-email/invitation-email-deliveries.port.js';
import type { InvitationEmailUnitOfWork } from '../../../../ports/outbound/persistence/invitation-email/invitation-email-unit-of-work.port.js';
import type { EmailSender } from '../../../../ports/outbound/smtp/code-email/email-sender.port.js';
import type { InvitationEmailRenderer } from '../../../../ports/outbound/templates/invitation-email/invitation-email-renderer.port.js';
import type { Clock } from '../../../../ports/outbound/time/code-email/clock.port.js';
import type { SendInvitationEmailInput } from './send-invitation-email.input.js';
import type { SendInvitationEmailOutput } from './send-invitation-email.output.js';

/**
 * Class SendInvitationEmail
 *
 * @description
 * Sends the e-mail of a `queued` invitation delivery, in the organization of the current context
 * (the organization of the job): renders it, hands it to the SMTP server outside any transaction,
 * then marks the delivery `sent` and deletes its content in a transaction of the
 * `InvitationEmailUnitOfWork`. Not a security e-mail: it offers `List-Unsubscribe` and its
 * one-click form (cw-email-templates). It goes to the address alone: the invitee may have no
 * account, so no name.
 *
 * Idempotent on the delivery: an attempt that finds the delivery already settled (sent, superseded
 * by a later version, expired or failed) does nothing. Delivery is still at least once: when the
 * server accepted the e-mail but the mark was lost, the next attempt sends it again, with the same
 * `Message-ID`. An invitation that expired before an attempt is not sent (`skipped`), as the
 * contract of `invitation.issued.v1` requires. When rendering or sending fails on the last attempt,
 * the delivery is marked `failed` and its content deleted before the error is rethrown.
 */
export class SendInvitationEmail {
  // #region Properties
  /**
   * Property unitOfWork
   *
   * @description
   * The transaction of each change of the delivery.
   *
   * @type {InvitationEmailUnitOfWork}
   * @readonly
   */
  private readonly unitOfWork: InvitationEmailUnitOfWork;

  /**
   * Property deliveries
   *
   * @description
   * The send log and the pending contents.
   *
   * @type {InvitationEmailDeliveries}
   * @readonly
   */
  private readonly deliveries: InvitationEmailDeliveries;

  /**
   * Property renderer
   *
   * @description
   * The compiled template.
   *
   * @type {InvitationEmailRenderer}
   * @readonly
   */
  private readonly renderer: InvitationEmailRenderer;

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
   * The current instant, to tell an expired invitation.
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
   * @param {InvitationEmailUnitOfWork} unitOfWork - The transaction of each change.
   * @param {InvitationEmailDeliveries} deliveries - The send log and the pending contents.
   * @param {InvitationEmailRenderer} renderer - The compiled template.
   * @param {EmailSender} sender - The SMTP server.
   * @param {Clock} clock - The current instant.
   * @constructor
   */
  public constructor(
    unitOfWork: InvitationEmailUnitOfWork,
    deliveries: InvitationEmailDeliveries,
    renderer: InvitationEmailRenderer,
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
   * @param {SendInvitationEmailInput} input - The delivery, whether this is its last attempt, and
   * the signal of the attempt.
   * @returns {Promise<SendInvitationEmailOutput>} What the attempt did.
   * @throws {Error} When the e-mail cannot be rendered, the SMTP server is unreachable or refuses
   * it, or the attempt was abandoned, so that the job is tried again.
   */
  public async execute(input: SendInvitationEmailInput): Promise<SendInvitationEmailOutput> {
    const delivery: InvitationEmailDelivery | null = await this.deliveries.find(input.deliveryId);
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
    const content: InvitationEmailDelivery['content'] = delivery.content;
    if (content === null) {
      await this.unitOfWork.run(() => this.deliveries.markFailed(delivery.id));
      return { outcome: 'failed' };
    }

    try {
      const rendered: RenderedEmail = this.renderer.renderInvitationEmail({
        invitationId: delivery.invitationId,
        inviterName: content.inviterName,
        organizationName: content.organizationName,
        memberCount: content.memberCount,
        role: delivery.role,
        expiresAt: delivery.validity.expiresAt,
      });
      if (input.signal?.aborted === true) {
        throw new AttemptAbandonedError();
      }
      await this.sender.send({
        ...rendered,
        id: delivery.id,
        to: { address: content.recipientEmail, name: '' },
        unsubscribe: true,
      });
    } catch (error) {
      if (input.lastAttempt) {
        await this.unitOfWork.run(() => this.deliveries.markFailed(delivery.id));
      }
      throw error;
    }
    await this.unitOfWork.run(() => this.deliveries.markSent(delivery.id));
    return { outcome: 'sent' };
  }
  // #endregion
}
