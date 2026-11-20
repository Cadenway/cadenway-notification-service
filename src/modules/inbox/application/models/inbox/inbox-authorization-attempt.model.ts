import type { InboxDeliveryCandidate } from './inbox-delivery-candidate.model.js';

/** Persisted candidate and its opaque, single-use authorization correlation. */
export interface InboxAuthorizationAttempt {
  // #region Properties
  /** Correlates one Task decision to its candidate in the same organization. */
  readonly id: string;

  /** Immutable source, recipient and task binding. */
  readonly candidate: InboxDeliveryCandidate;

  /** Exclusive deadline, in UTC epoch milliseconds. */
  readonly expiresAt: number;

  /** Terminal attempts cannot create another notification. */
  readonly outcome: 'pending' | 'permitted' | 'denied' | 'expired';
  // #endregion
}
