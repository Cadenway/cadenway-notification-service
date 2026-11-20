/** A private, recipient-specific inbox candidate derived from a validated Task fact. */
export interface InboxDeliveryCandidate {
  // #region Properties
  /** Organization in the trusted event envelope. */
  readonly organizationId: string;

  /** Original fact identity used to deduplicate the recipient's delivery. */
  readonly sourceEventId: string;

  /** Account that may receive the notification after a current authorization decision. */
  readonly recipientId: string;

  /** Human actor when the original fact has one. */
  readonly actorUserId: string | null;

  /** Category of the recipient's notification. */
  readonly kind: 'assignment' | 'comment' | 'mention' | 'status-change' | 'approval' | 'access';

  /** Task reference checked by Task. Never display names or other source text here. */
  readonly taskKey: string;

  /** Optional reference used by the gateway to resolve a currently readable excerpt. */
  readonly commentId: string | null;

  /** Status key recorded by a status change. */
  readonly status: string | null;
  // #endregion
}
