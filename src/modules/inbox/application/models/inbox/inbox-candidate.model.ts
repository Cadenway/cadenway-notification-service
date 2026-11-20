import type { InboxSubject } from './inbox-subject.model.js';

/** Private recipient-owned record awaiting a current resource visibility check. */
export interface InboxCandidate {
  // #region Properties
  /** Notification identity. */
  readonly id: string;

  /** Notification category. */
  readonly kind: string;

  /** The account that caused the event, when present. */
  readonly actorUserId: string | null;

  /** Exact persisted selector, or null for an owner-only notification. */
  readonly subject: InboxSubject;

  /** A live comment can later supply an authorized excerpt. */
  readonly commentId?: string;

  /** Status associated with the source event, when applicable. */
  readonly status?: string;

  /** Creation instant in UTC. */
  readonly createdAt: string;

  /** First read instant, or null. */
  readonly readAt: string | null;

  /** First archive instant, or null. */
  readonly archivedAt: string | null;

  /** Optimistic version of the notification. */
  readonly version: number;
  // #endregion
}
