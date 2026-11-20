import type { ActivityEmailOccurrence } from '../../../../../domain/value-objects/digest/activity-email-occurrence.value-object.js';
import type { ActivityEmailAssignment } from '../../../../models/digest/activity-email-assignment.model.js';
import type { ActivityEmailCandidate } from '../../../../models/digest/activity-email-candidate.model.js';
import type { ActivityEmailDigestSlot } from '../../../../models/digest/activity-email-digest-slot.model.js';
import type { ActivityEmailPreferences } from '../../../../models/digest/activity-email-preferences.model.js';
import type { ActivityEmailReservation } from '../../../../models/digest/activity-email-reservation.model.js';

/** Atomic state and enqueue operations in the service-owned database. */
export interface ActivityEmailStore {
  // #region Methods
  /** Read email choices for one source recipient under the preference lock. */
  lockIntakePreferences(organizationId: string, userId: string): Promise<ActivityEmailPreferences>;

  /** Insert candidates once per tenant, source fact and recipient. Return the inserted accounts. */
  insertCandidates(
    organizationId: string,
    candidates: readonly ActivityEmailCandidate[],
  ): Promise<readonly string[]>;

  /** Lock account preferences and the scheduling state in the current transaction. */
  lockPreferences(userId: string): Promise<ActivityEmailPreferences>;

  /** Return at most one page plus one lookahead, in creation order, for the selected kinds. */
  listPendingCandidateIds(
    userId: string,
    kinds: readonly ActivityEmailCandidate['kind'][],
    createdByMs: number | null,
    limit: number,
  ): Promise<readonly string[]>;

  /** Reserve an immediate occurrence for each candidate, reopening only superseded generations. */
  reserveIndividuals(
    userId: string,
    occurrence: Extract<ActivityEmailOccurrence, { cadence: 'each' }>,
    preferenceVersion: number,
    candidateIds: readonly string[],
  ): Promise<readonly ActivityEmailAssignment[]>;

  /** Read the single digest slot for the given cadence and local date. */
  findDigestSlot(
    userId: string,
    occurrence: Exclude<ActivityEmailOccurrence, { cadence: 'each' }>,
  ): Promise<ActivityEmailDigestSlot | null>;

  /** Read the bounded count already tied to a live slot and its exact generation. */
  countDigestAssignments(userId: string, reservation: ActivityEmailReservation): Promise<number>;

  /** Reserve the slot or reopen its superseded generation within the account transaction. */
  reserveDigest(
    userId: string,
    occurrence: Exclude<ActivityEmailOccurrence, { cadence: 'each' }>,
    preferenceVersion: number,
  ): Promise<ActivityEmailReservation>;

  /** Assign the entire page to its reservations, or fail the transaction. */
  assignCandidates(userId: string, assignments: readonly ActivityEmailAssignment[]): Promise<void>;

  /** Enqueue planning now, or at a durable overflow continuation's selected instant. */
  enqueuePlan(userId: string, notBeforeMs: number, runAt?: number): Promise<void>;

  /** Enqueue the exact occurrence generation for the selected instant. */
  enqueueDelivery(
    userId: string,
    reservation: ActivityEmailReservation,
    dueAtMs: number,
  ): Promise<void>;
  // #endregion
}
