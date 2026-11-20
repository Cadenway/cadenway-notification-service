import type { InboxCandidate } from '../../../../models/inbox/inbox-candidate.model.js';
import type { InboxSubject } from '../../../../models/inbox/inbox-subject.model.js';

/** Atomic recipient operations after Gateway checks current subject visibility. */
export interface InboxSelectionStore {
  // #region Methods
  /** Checks the exact linkage before the supplied version condition and transition. */
  change(
    organizationId: string,
    recipientId: string,
    id: string,
    subject: InboxSubject,
    action: 'read' | 'archive',
    expectedVersions: readonly number[] | '*' | undefined,
    now: number,
  ): Promise<
    | { readonly kind: 'not-found' }
    | { readonly kind: 'version-mismatch'; readonly currentVersion: number }
    | { readonly kind: 'ok'; readonly record: InboxCandidate }
  >;

  /** Marks authorized records through the original creation cutoff in the locked generation. */
  readAll(
    organizationId: string,
    recipientId: string,
    snapshotGeneration: string,
    creationCutoff: string,
    authorizedSubjects: readonly Exclude<InboxSubject, null>[],
    now: number,
  ): Promise<{ readonly markedRead: number; readonly unreadCount: number }>;
  // #endregion
}
