import type { InboxCandidate } from '../../../../models/inbox/inbox-candidate.model.js';
import type { InboxCandidatePosition } from '../../../../models/inbox/inbox-candidate-position.model.js';

/** Bounded candidate page with its internal continuation. */
export interface ListInboxCandidatesOutput {
  // #region Properties
  /** Candidates and their exact positions. */
  readonly items: readonly {
    readonly record: InboxCandidate;
    readonly cursorAfter: InboxCandidatePosition;
  }[];

  /** The last consumed position when another record exists. */
  readonly next: InboxCandidatePosition | null;
  // #endregion
}
