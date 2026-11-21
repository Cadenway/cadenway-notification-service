import { ContactSubmission } from '../../../../../domain/value-objects/forms/contact-submission.value-object.js';
import type { ContactSubmissionUnitOfWork } from '../../../../ports/outbound/transactions/forms/contact-submission-unit-of-work.port.js';
import type { SubmitContactInput } from './submit-contact.input.js';
import type { SubmitContactOutput } from './submit-contact.output.js';

/** Keeps contact retries for 24 hours after the acceptance transaction. */
const receiptRetentionMs = 24 * 60 * 60 * 1_000;

/** Accepts a contact form and durable support delivery together. */
export class SubmitContact {
  // #region Constructor
  /** Uses a system transaction and admits new submissions only when delivery is configured. */
  public constructor(
    private readonly work: ContactSubmissionUnitOfWork,
    private readonly deliveryEnabled: boolean,
  ) {}
  // #endregion

  // #region Methods
  /** Replays an equivalent submission without creating another delivery. */
  public async execute(input: SubmitContactInput): Promise<SubmitContactOutput> {
    const submission = ContactSubmission.of(input);
    return await this.work.run(async (transaction) => {
      const reservation = await transaction.reserve(
        input.idempotencyKey,
        submission,
        receiptRetentionMs,
      );
      if (reservation === 'replayed') return 'accepted';
      if (reservation !== 'new') return reservation;

      if (!this.deliveryEnabled) throw new Error('Contact delivery is unavailable.');

      const submissionId = await transaction.save(input.idempotencyKey, submission);
      await transaction.enqueueDelivery(submissionId);
      return 'accepted';
    });
  }
  // #endregion
}
