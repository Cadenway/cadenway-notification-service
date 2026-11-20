import type { InboxCandidate } from '../../../../models/inbox/inbox-candidate.model.js';
import type { InboxCandidatePosition } from '../../../../models/inbox/inbox-candidate-position.model.js';
import type { InboxSubjectPosition } from '../../../../models/inbox/inbox-subject-position.model.js';
import type { InboxSubject } from '../../../../models/inbox/inbox-subject.model.js';

/** Private reads scoped to a verified tenant and recipient. */
export interface InboxCandidatesReader {
  // #region Methods
  /** Reads a bounded page of candidates and the position after each one. */
  pageCandidates(
    organizationId: string,
    recipientId: string,
    state: 'active' | 'unread' | 'archived',
    after: InboxCandidatePosition | null,
    limit: number,
  ): Promise<
    readonly { readonly record: InboxCandidate; readonly cursorAfter: InboxCandidatePosition }[]
  >;

  /** Finds an owned candidate, including archived records. */
  findCandidate(
    organizationId: string,
    recipientId: string,
    id: string,
  ): Promise<InboxCandidate | null>;

  /** Reads unread groups and their generation in a single consistent snapshot. */
  unreadSubjects(
    organizationId: string,
    recipientId: string,
    expectedGeneration: string | null,
    after: InboxSubjectPosition | null,
    limit: number,
  ): Promise<{
    readonly generation: string;
    readonly items: readonly { readonly subject: InboxSubject; readonly count: number }[];
    readonly next: InboxSubjectPosition | null;
  }>;
  // #endregion
}
