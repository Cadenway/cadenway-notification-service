import type { InboxSubject } from '../../../../models/inbox/inbox-subject.model.js';

/** Full visibility decision with a stable scan generation and original creation cutoff. */
export interface ReadSelectedNotificationsInput {
  // #region Properties
  /** Verified tenant. */
  readonly organizationId: string;

  /** Verified account. */
  readonly recipientId: string;

  /** Owner generation for which the subject scan completed. */
  readonly snapshotGeneration: string;

  /** Generation observed at the start of the read-all operation. */
  readonly creationCutoff: string;

  /** Exact non-null subjects authorized by Gateway. */
  readonly authorizedSubjects: readonly Exclude<InboxSubject, null>[];
  // #endregion
}
