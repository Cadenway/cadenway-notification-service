import type { ActivityAuthorizationAttempt } from './activity-authorization-attempt.model.js';
import type { ActivityEmailCandidate } from './activity-email-candidate.model.js';

/** Current authorization data for an assigned activity candidate. */
export interface ActivityDeliveryDecision {
  // #region Properties
  /** The account and current availability of the candidate's authorization. */
  readonly recipientId: string;
  readonly kind: ActivityEmailCandidate['kind'];
  readonly outcome: ActivityAuthorizationAttempt['outcome'] | null;
  readonly validUntil: number | null;
  // #endregion
}
