import type { ActivityEmailDelivery } from '../../../../models/digest/activity-email-delivery.model.js';
import type { ActivityAuthorizationAttempt } from '../../../../models/digest/activity-authorization-attempt.model.js';

/** State transitions and durable Task authorization requests for one account occurrence. */
export interface ActivityDeliveryStore {
  // #region Methods
  /** Lock only the exact Task correlation in its originating organization. */
  lockAttempt(
    organizationId: string,
    attemptId: string,
  ): Promise<ActivityAuthorizationAttempt | null>;

  /** Commit one terminal Task decision; it applies only to the locked attempt generation. */
  finishAttempt(
    organizationId: string,
    attemptId: string,
    outcome: 'permitted' | 'denied' | 'expired',
    validUntil: number,
  ): Promise<void>;

  /** Suppress an occurrence whose account is missing, inactive, deleted or unverified. */
  skipRecipient(userId: string, occurrenceId: string, generation: number): Promise<void>;

  /** Lock the occurrence and create fresh Task requests for this organization in its tenant transaction.
   * A retry reuses a live correlation and replaces an elapsed one without accepting its late response.
   */
  requestAuthorization(
    organizationId: string,
    userId: string,
    occurrenceId: string,
    generation: number,
    expiresAt: number,
  ): Promise<void>;

  /** Lock the occurrence, current settings and decisions, then lease one bounded ready batch.
   * Return null while a decision is missing, stale or being renewed, or another lease is active.
   * A changed cadence, preference version or account profile invalidates and requeues the occurrence.
   */
  leaseAuthorized(
    userId: string,
    occurrenceId: string,
    generation: number,
    profileVersion: number,
    limit: number,
  ): Promise<ActivityEmailDelivery | null>;

  /** Record delivery or an empty result only when the same generation and lease still own it. */
  finish(
    userId: string,
    occurrenceId: string,
    generation: number,
    leaseId: string,
  ): Promise<boolean>;

  /** Release the matching lease for bounded retry after a transient dependency failure. */
  release(userId: string, occurrenceId: string, generation: number, leaseId: string): Promise<void>;
  // #endregion
}
