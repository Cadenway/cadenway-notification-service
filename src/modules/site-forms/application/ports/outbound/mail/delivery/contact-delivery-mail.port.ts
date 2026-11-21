import type { ContactSubmission } from '../../../../../domain/value-objects/forms/contact-submission.value-object.js';

/** Delivers a plain-text support message under a stable identity across retries. */
export interface ContactDeliveryMail {
  // #region Properties
  /** Sends to the configured support mailbox and uses the visitor address only as Reply-To. */
  readonly send: (input: {
    readonly submissionId: string;
    readonly supportAddress: string;
    readonly replyTo: string;
    readonly subject: ReturnType<ContactSubmission['subject']>;
    readonly message: string;
  }) => Promise<void>;
  // #endregion
}
