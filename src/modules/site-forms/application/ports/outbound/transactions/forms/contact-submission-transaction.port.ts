import type { ContactSubmission } from '../../../../../domain/value-objects/forms/contact-submission.value-object.js';

/** Operations that share the contact submission and durable job transaction. */
export interface ContactSubmissionTransaction {
  // #region Properties
  /**
   * Tries to reserve the key without waiting for a concurrent owner. A completed unexpired
   * reservation replays only when all validated submission fields match. Retention begins no
   * earlier than acceptance commits. An expired reservation may be replaced. The comparison
   * must not put contact data in logs, traces or job payloads.
   */
  readonly reserve: (
    key: string,
    submission: ContactSubmission,
    retentionMs: number,
  ) => Promise<'new' | 'replayed' | 'in-progress' | 'key-reused'>;

  /** Persists the submission and associates it with the reserved key. */
  readonly save: (key: string, submission: ContactSubmission) => Promise<string>;

  /** Enqueues exactly one durable delivery intent carrying only the persisted submission ID. */
  readonly enqueueDelivery: (submissionId: string) => Promise<void>;
  // #endregion
}
