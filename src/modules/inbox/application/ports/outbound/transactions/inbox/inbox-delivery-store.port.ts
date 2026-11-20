import type { InboxNotification } from '../../../../../domain/aggregates/inbox/inbox-notification.aggregate.js';
import type { NotificationCreated } from '../../../../../domain/events/inbox/notification-created.event.js';
import type { InboxAuthorizationAttempt } from '../../../../models/inbox/inbox-authorization-attempt.model.js';
import type { InboxDeliveryCandidate } from '../../../../models/inbox/inbox-delivery-candidate.model.js';

/** Recipient delivery operations backed by the active tenant transaction. */
export interface InboxDeliveryStore {
  // #region Methods
  /** Records each new candidate and queues one immutable request for its current access. */
  stage(candidates: readonly InboxDeliveryCandidate[], expiresAt: number): Promise<number>;

  /** Locks the exact authorization correlation, scoped to this tenant. */
  lockAttempt(organizationId: string, id: string): Promise<InboxAuthorizationAttempt | null>;

  /** Rotates a locked, elapsed correlation and queues the new request and deadline check. */
  renewAttempt(
    organizationId: string,
    id: string,
    expiresAt: number,
    retryCount: number,
  ): Promise<void>;

  /** Allocates the new record ID from PostgreSQL. */
  newNotificationId(organizationId: string): Promise<string>;

  /** Persists the recipient's inbox record and appends its redacted fact. */
  insertNotification(
    candidate: InboxDeliveryCandidate,
    notification: InboxNotification,
    fact: NotificationCreated,
  ): Promise<boolean>;

  /** Marks the locked attempt terminal in the same transaction as any inbox effect. */
  finishAttempt(
    organizationId: string,
    id: string,
    outcome: Exclude<InboxAuthorizationAttempt['outcome'], 'pending'>,
  ): Promise<void>;
  // #endregion
}
