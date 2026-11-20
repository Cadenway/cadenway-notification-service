import type { ActivityEmailSender } from '../../../../ports/outbound/email/digest/activity-email-sender.port.js';
import type { ActivityRecipientReader } from '../../../../ports/outbound/identity/digest/activity-recipient-reader.port.js';
import type { ActivityDeliveryUnitOfWork } from '../../../../ports/outbound/transactions/digest/activity-delivery-unit-of-work.port.js';
import type { SendActivityEmailInput } from './send-activity-email.input.js';
import type { SendActivityEmailOutput } from './send-activity-email.output.js';

const pageSize = 100;

/** Sends a leased occurrence only while each included Task permit remains valid. */
export class SendActivityEmail {
  // #region Constructor
  /** Binds the current Identity reader, durable state and existing email capability. */
  public constructor(
    private readonly recipients: ActivityRecipientReader,
    private readonly work: ActivityDeliveryUnitOfWork,
    private readonly email: ActivityEmailSender,
    private readonly clock: () => number,
  ) {}
  // #endregion

  // #region Methods
  /** Temporary failures release the lease and propagate to bounded job retries. */
  public async execute(
    input: SendActivityEmailInput,
    signal?: AbortSignal,
  ): Promise<SendActivityEmailOutput> {
    signal?.throwIfAborted();
    const recipient = await this.recipients.findCurrent(input.userId);
    signal?.throwIfAborted();
    if (recipient === null) {
      await this.work.runAccount(input.userId, (store) =>
        store.skipRecipient(input.userId, input.occurrenceId, input.generation),
      );
      return 'empty';
    }
    if (recipient.userId.toLowerCase() !== input.userId.toLowerCase()) {
      throw new Error('Activity recipient does not match the requested account.');
    }
    const delivery = await this.work.runAccount(input.userId, (store) =>
      store.leaseAuthorized(
        input.userId,
        input.occurrenceId,
        input.generation,
        recipient.version,
        pageSize,
      ),
    );
    if (delivery === null) return 'pending';
    try {
      if (
        delivery.recipientId.toLowerCase() !== input.userId.toLowerCase() ||
        delivery.profileVersion !== recipient.version ||
        delivery.occurrenceId !== input.occurrenceId ||
        delivery.generation !== input.generation ||
        delivery.items.length > pageSize
      ) {
        throw new Error('Activity delivery lease does not match the requested occurrence.');
      }
      const permitted = delivery.items.filter(({ decision }) => decision === 'permit');
      if (
        permitted.some(
          ({ candidate, validUntil }) =>
            candidate.recipientId.toLowerCase() !== input.userId.toLowerCase() ||
            !Number.isSafeInteger(validUntil) ||
            validUntil <= this.clock(),
        )
      ) {
        return 'pending';
      }
      if (permitted.length > 0) {
        const validUntil = Math.min(...permitted.map((item) => item.validUntil));
        if (this.clock() >= validUntil) return 'pending';
        signal?.throwIfAborted();
        await this.email.send({
          occurrenceId: delivery.occurrenceId,
          recipient,
          count: permitted.length,
          validUntil,
        });
      }
      const finished = await this.work.runAccount(input.userId, (store) =>
        store.finish(input.userId, input.occurrenceId, input.generation, delivery.leaseId),
      );
      if (!finished) throw new Error('Activity delivery lease was lost.');
      return permitted.length === 0 ? 'empty' : 'sent';
    } finally {
      await this.work.runAccount(input.userId, (store) =>
        store.release(input.userId, input.occurrenceId, input.generation, delivery.leaseId),
      );
    }
  }
  // #endregion
}
