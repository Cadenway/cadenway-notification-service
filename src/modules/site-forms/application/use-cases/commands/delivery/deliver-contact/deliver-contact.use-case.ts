import type { ContactDeliveryMail } from '../../../../ports/outbound/mail/delivery/contact-delivery-mail.port.js';
import type { ContactDeliveries } from '../../../../ports/outbound/persistence/delivery/contact-deliveries.port.js';
import type { DeliverContactInput } from './deliver-contact.input.js';

/** Delivers a pending contact submission outside its database transactions. */
export class DeliverContact {
  // #region Constructor
  /** Receives the persistence and mail ports and the server-controlled support mailbox. */
  public constructor(
    private readonly deliveries: ContactDeliveries,
    private readonly mail: ContactDeliveryMail,
    private readonly supportAddress: string | undefined,
  ) {}
  // #endregion

  // #region Methods
  /** Skips settled jobs and keeps a stable Message-ID if SMTP acceptance is uncertain. */
  public async execute(input: DeliverContactInput): Promise<void> {
    const submission = await this.deliveries.loadPending(input.submissionId);
    if (submission === null) return;

    const supportAddress = this.supportAddress;
    if (input.signal.aborted || supportAddress === undefined) return await this.fail(input);

    try {
      await this.mail.send({
        submissionId: input.submissionId,
        supportAddress,
        replyTo: submission.replyTo().address(),
        subject: submission.subject(),
        message: submission.message(),
      });
    } catch {
      return await this.fail(input);
    }

    // Record an accepted SMTP send even if the job lease expired while SMTP was in flight.
    await this.deliveries.settlePending(input.submissionId, 'sent');
  }

  /** Records an exhausted delivery and returns only a fixed error to the worker. */
  private async fail(input: DeliverContactInput): Promise<never> {
    if (input.lastAttempt) await this.deliveries.settlePending(input.submissionId, 'failed');
    throw new Error('Site contact delivery failed.');
  }
  // #endregion
}
