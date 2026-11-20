import type { ActivityAuthorizationAttempt } from '../../../../models/digest/activity-authorization-attempt.model.js';
import type { ActivityAuthorizationCandidate } from '../../../../models/digest/activity-authorization-candidate.model.js';
import type { ActivityDeliveryDecision } from '../../../../models/digest/activity-delivery-decision.model.js';
import type { ActivityEmailDelivery } from '../../../../models/digest/activity-email-delivery.model.js';
import type { ActivityEmailPreferences } from '../../../../models/digest/activity-email-preferences.model.js';

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

  /** Lock the account in this tenant transaction and read its bounded candidate page. */
  listAuthorizationCandidates(
    organizationId: string,
    userId: string,
    occurrenceId: string,
    generation: number,
  ): Promise<readonly ActivityAuthorizationCandidate[]>;

  /** Reserve only attempts whose current correlation may be rotated under the database clock. */
  reserveAuthorizationAttempts(
    organizationId: string,
    userId: string,
    occurrenceId: string,
    generation: number,
    expiresAt: number,
    candidateIds: readonly string[],
  ): Promise<readonly { readonly attemptId: string; readonly candidateId: string }[]>;

  /** Append the Task fact in the transaction that reserved its correlation. */
  appendAuthorization(
    request: Readonly<{
      attemptId: string;
      organizationId: string;
      recipientId: string;
      taskKey: string;
      expiresAt: number;
    }>,
  ): Promise<void>;

  /** Lock a due occurrence with no live lease. */
  lockDueOccurrence(
    userId: string,
    occurrenceId: string,
    generation: number,
  ): Promise<ActivityEmailDelivery | null>;

  /** Read the current email choices under the account preference lock. */
  readPreferences(userId: string): Promise<ActivityEmailPreferences>;

  /** Read the bounded candidates and current Task decisions for a locked generation. */
  listDeliveryDecisions(
    userId: string,
    occurrenceId: string,
    generation: number,
  ): Promise<readonly ActivityDeliveryDecision[]>;

  /** Claim the locked occurrence while no live lease holds it. */
  claim(
    userId: string,
    occurrenceId: string,
    generation: number,
  ): Promise<{ readonly id: string; readonly validUntil: number }>;

  /** Advance the generation and detach its items when the expected lease state still holds. */
  supersede(
    userId: string,
    occurrenceId: string,
    generation: number,
    leaseId?: string,
  ): Promise<boolean>;

  /** Enqueue a new planning pass in the same account transaction. */
  enqueuePlan(userId: string, notBeforeMs: number): Promise<void>;

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
