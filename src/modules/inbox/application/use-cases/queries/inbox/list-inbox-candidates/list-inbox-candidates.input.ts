import type { InboxCandidatePosition } from '../../../../models/inbox/inbox-candidate-position.model.js';

/** Validated private candidate page request. */
export interface ListInboxCandidatesInput {
  // #region Properties
  /** Verified tenant. */
  readonly organizationId: string;

  /** Verified account. */
  readonly recipientId: string;

  /** Candidate state filter. */
  readonly state: 'active' | 'unread' | 'archived';

  /** Decoded owner and filter-bound cursor. */
  readonly after: InboxCandidatePosition | null;

  /** Requested page size, from 1 through 100. */
  readonly limit: number;
  // #endregion
}
