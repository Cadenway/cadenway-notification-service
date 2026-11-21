import type { ContactSubmission } from '../../../../../domain/value-objects/forms/contact-submission.value-object.js';

/** Loads and settles a global support delivery in separate, short system transactions. */
export interface ContactDeliveries {
  // #region Properties
  /** Reads only the pending submission identified by the durable job. */
  readonly loadPending: (submissionId: string) => Promise<ContactSubmission | null>;

  /** Changes a pending row once and preserves a previous terminal outcome. */
  readonly settlePending: (submissionId: string, status: 'sent' | 'failed') => Promise<void>;
  // #endregion
}
