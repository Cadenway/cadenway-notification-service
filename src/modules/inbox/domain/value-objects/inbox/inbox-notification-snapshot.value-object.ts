/** Persisted inbox state. Instants are UTC epoch milliseconds and resource IDs are stable. */
export interface InboxNotificationSnapshot {
  // #region Properties
  /** Stable identifier issued at creation. */
  readonly id: string;
  readonly organizationId: string;
  readonly recipientId: string;
  readonly kind: string;
  readonly actorUserId: string | null;
  readonly subject: { readonly kind: 'task' | 'space' | 'list'; readonly id: string } | null;
  readonly createdAt: number;
  readonly readAt: number | null;
  readonly archivedAt: number | null;
  readonly version: number;
  // #endregion
}
