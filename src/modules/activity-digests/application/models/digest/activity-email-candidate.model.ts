/** A private candidate derived from one validated, tenant-scoped activity fact. */
export interface ActivityEmailCandidate {
  // #region Properties
  /** Organization from the trusted source event. */
  readonly organizationId: string;

  /** Stable source event used with recipientId for deduplication. */
  readonly sourceEventId: string;

  /** Account receiving the activity. */
  readonly recipientId: string;

  /** Human source actor, if present. */
  readonly actorUserId: string | null;

  /** Source-defined category, selected before staging. */
  readonly kind: 'assignment' | 'comment' | 'mention' | 'status-change' | 'approval' | 'access';

  /** Task identity to authorize immediately before delivery. */
  readonly taskKey: string;

  /** Optional comment selector; source text is resolved only after authorization. */
  readonly commentId: string | null;

  /** Status selector, when the source is a status change. */
  readonly status: string | null;
  // #endregion
}
