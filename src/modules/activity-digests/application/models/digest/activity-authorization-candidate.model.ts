import type { ActivityAuthorizationAttempt } from './activity-authorization-attempt.model.js';

/** An assigned tenant candidate and its latest Task authorization attempt. */
export interface ActivityAuthorizationCandidate {
  // #region Properties
  /** Tenant candidate selector and the DB deadlines of its current correlation. */
  readonly candidateId: string;
  readonly taskKey: string;
  readonly outcome: ActivityAuthorizationAttempt['outcome'] | null;
  readonly expiresAt: number | null;
  readonly validUntil: number | null;
  // #endregion
}
