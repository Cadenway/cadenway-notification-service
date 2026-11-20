import { and, asc, eq, inArray, isNull, lte, sql } from 'drizzle-orm';

import type { ActivityEmailAssignment } from '../../../../../application/models/digest/activity-email-assignment.model.js';
import type { ActivityEmailCandidate } from '../../../../../application/models/digest/activity-email-candidate.model.js';
import type { ActivityEmailDigestSlot } from '../../../../../application/models/digest/activity-email-digest-slot.model.js';
import type { ActivityEmailPreferences } from '../../../../../application/models/digest/activity-email-preferences.model.js';
import type { ActivityEmailReservation } from '../../../../../application/models/digest/activity-email-reservation.model.js';
import type { ActivityEmailStore } from '../../../../../application/ports/outbound/transactions/digest/activity-email-store.port.js';
import { activityEmailPageSize } from '../../../../../domain/policies/digest/activity-email-schedule.policy.js';
import type { ActivityEmailOccurrence } from '../../../../../domain/value-objects/digest/activity-email-occurrence.value-object.js';
import { activityEmailCandidates as candidates } from '../../schemas/digest/activity-email-candidates.schema.js';
import { activityEmailOccurrences as occurrences } from '../../schemas/digest/activity-email-occurrences.schema.js';
import type {
  ActivityDigestPersistenceBindings,
  ActivityDigestScope,
} from '../../transactions/digest/drizzle-activity-digest.unit-of-work.js';

const insertBatchSize = 250;
const digestBatchNumber = 1;

/** Caps account work and tenant fan-out for a single occurrence. */
export const maxActivityDigestBatchSize: number = activityEmailPageSize;

/** Checks explicit bounds before emitting a LIMIT or writing a batch. */
export function validateActivityDigestBatchSize(limit: number): void {
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > maxActivityDigestBatchSize) {
    throw new RangeError('Activity email page size must be between 1 and 100.');
  }
}

/** Maps candidate and occurrence state within the caller's bound transaction. */
export class DrizzleActivityEmail implements ActivityEmailStore {
  // #region Constructor
  /** Binds rows and transactional side effects to one account or tenant transaction. */
  public constructor(
    private readonly scope: ActivityDigestScope,
    private readonly bindings: Pick<
      ActivityDigestPersistenceBindings,
      'readPreferences' | 'enqueuePlan' | 'enqueueDelivery'
    >,
  ) {}
  // #endregion

  // #region Methods
  /** Reads the source recipient's settings within the verified tenant transaction. */
  public lockIntakePreferences(
    organizationId: string,
    userId: string,
  ): Promise<ActivityEmailPreferences> {
    this.scope.requireTenant(organizationId);
    return this.bindings.readPreferences(this.scope.transaction, userId);
  }

  /** Inserts the immutable source-recipient pairs in bounded SQL statements. */
  public async insertCandidates(
    organizationId: string,
    values: readonly ActivityEmailCandidate[],
  ): Promise<readonly string[]> {
    const tenantId = this.scope.requireTenant(organizationId);
    if (values.some((value) => value.organizationId.toLowerCase() !== tenantId)) {
      throw new Error('Activity email candidate belongs to another organization.');
    }
    const { db } = this.scope.transaction;
    const insertedAccounts: string[] = [];
    for (let index = 0; index < values.length; index += insertBatchSize) {
      const inserted = await db
        .insert(candidates)
        .values(values.slice(index, index + insertBatchSize))
        .onConflictDoNothing({
          target: [candidates.organizationId, candidates.recipientId, candidates.sourceEventId],
        })
        .returning({ userId: candidates.recipientId });
      insertedAccounts.push(...inserted.map(({ userId }) => userId));
    }
    return insertedAccounts;
  }

  /** Reads email choices under the account and preference locks. */
  public lockPreferences(userId: string): Promise<ActivityEmailPreferences> {
    return this.bindings.readPreferences(this.scope.transaction, this.scope.requireAccount(userId));
  }

  /** Reads a bounded ordered page of unassigned candidates matching the supplied predicates. */
  public async listPendingCandidateIds(
    userId: string,
    kinds: readonly ActivityEmailCandidate['kind'][],
    createdByMs: number | null,
    limit: number,
  ): Promise<readonly string[]> {
    const recipientId = this.scope.requireAccount(userId);
    validateActivityDigestBatchSize(limit);
    if (kinds.length === 0) return [];
    const rows = await this.scope.transaction.db
      .select({ id: candidates.id })
      .from(candidates)
      .where(
        and(
          eq(candidates.recipientId, recipientId),
          isNull(candidates.occurrenceId),
          isNull(candidates.settledAt),
          inArray(candidates.kind, kinds),
          createdByMs === null ? undefined : lte(candidates.createdAt, new Date(createdByMs)),
        ),
      )
      .orderBy(asc(candidates.createdAt), asc(candidates.id))
      .limit(limit + 1);
    return rows.map(({ id }) => id);
  }

  /** Keeps an immediate occurrence's identity when its generation needs a new profile. */
  public async reserveIndividuals(
    userId: string,
    occurrence: Extract<ActivityEmailOccurrence, { cadence: 'each' }>,
    preferenceVersion: number,
    ids: readonly string[],
  ): Promise<readonly ActivityEmailAssignment[]> {
    const recipientId = this.scope.requireAccount(userId);
    validateActivityDigestBatchSize(ids.length);
    const values = {
      recipientId,
      dueAt: new Date(occurrence.dueAtMs),
      preferenceVersion,
      profileVersion: occurrence.profileVersion,
    };
    const rows = await this.scope.transaction.db
      .insert(occurrences)
      .values(
        ids.map((individualCandidateId) => ({
          ...values,
          cadence: 'each' as const,
          individualCandidateId,
        })),
      )
      .onConflictDoUpdate({
        target: [occurrences.recipientId, occurrences.individualCandidateId],
        set: { ...values, state: 'scheduled', updatedAt: sql`clock_timestamp()` },
        setWhere: eq(occurrences.state, 'superseded'),
      })
      .returning({
        id: occurrences.id,
        individualCandidateId: occurrences.individualCandidateId,
        generation: occurrences.generation,
      });
    if (rows.length !== ids.length) {
      throw new Error('An unassigned activity candidate already owns a live occurrence.');
    }
    return rows.map(({ id, individualCandidateId, generation }) => {
      if (individualCandidateId === null)
        throw new Error('The immediate occurrence has no candidate.');
      return { candidateId: individualCandidateId, reservation: { id, generation } };
    });
  }

  /** Reads current scheduling state for the account's unique slot for this cadence and date. */
  public async findDigestSlot(
    userId: string,
    occurrence: Exclude<ActivityEmailOccurrence, { cadence: 'each' }>,
  ): Promise<ActivityEmailDigestSlot | null> {
    const recipientId = this.scope.requireAccount(userId);
    const [row] = await this.scope.transaction.db
      .select({
        id: occurrences.id,
        generation: occurrences.generation,
        state: occurrences.state,
        dueAt: occurrences.dueAt,
        profileVersion: occurrences.profileVersion,
        acceptsAssignments: sql<boolean>`${occurrences.dueAt} > clock_timestamp() and ${occurrences.leaseId} is null`,
      })
      .from(occurrences)
      .where(
        and(
          eq(occurrences.recipientId, recipientId),
          eq(occurrences.cadence, occurrence.cadence),
          eq(occurrences.localDate, occurrence.localDate),
          eq(occurrences.batchNumber, digestBatchNumber),
        ),
      )
      .limit(1);
    if (row === undefined) return null;
    const { dueAt, ...slot } = row;
    return { ...slot, dueAtMs: dueAt.getTime() };
  }

  /** Counts only rows assigned to the precise account and generation. */
  public async countDigestAssignments(
    userId: string,
    reservation: ActivityEmailReservation,
  ): Promise<number> {
    const recipientId = this.scope.requireAccount(userId);
    const rows = await this.scope.transaction.db
      .select({ id: candidates.id })
      .from(candidates)
      .where(
        and(
          eq(candidates.recipientId, recipientId),
          eq(candidates.occurrenceId, reservation.id),
          eq(candidates.generation, reservation.generation),
        ),
      )
      .limit(maxActivityDigestBatchSize + 1);
    if (rows.length > maxActivityDigestBatchSize) {
      throw new Error('The activity email occurrence exceeds its candidate limit.');
    }
    return rows.length;
  }

  /** Registers the account slot or conditionally reopens its superseded generation. */
  public async reserveDigest(
    userId: string,
    occurrence: Exclude<ActivityEmailOccurrence, { cadence: 'each' }>,
    preferenceVersion: number,
  ): Promise<ActivityEmailReservation> {
    const recipientId = this.scope.requireAccount(userId);
    const values = {
      recipientId,
      dueAt: new Date(occurrence.dueAtMs),
      preferenceVersion,
      profileVersion: occurrence.profileVersion,
    };
    const [reserved] = await this.scope.transaction.db
      .insert(occurrences)
      .values({
        ...values,
        cadence: occurrence.cadence,
        localDate: occurrence.localDate,
        batchNumber: digestBatchNumber,
      })
      .onConflictDoUpdate({
        target: [
          occurrences.recipientId,
          occurrences.cadence,
          occurrences.localDate,
          occurrences.batchNumber,
        ],
        set: { ...values, state: 'scheduled', updatedAt: sql`clock_timestamp()` },
        setWhere: eq(occurrences.state, 'superseded'),
      })
      .returning({ id: occurrences.id, generation: occurrences.generation });
    if (reserved === undefined)
      throw new Error('The activity email slot changed under its account lock.');
    return reserved;
  }

  /** Assigns the complete page and verifies that no candidate was already claimed. */
  public async assignCandidates(
    userId: string,
    batch: readonly ActivityEmailAssignment[],
  ): Promise<void> {
    const recipientId = this.scope.requireAccount(userId);
    validateActivityDigestBatchSize(batch.length);
    const values = sql.join(
      batch.map(
        ({ candidateId, reservation }) =>
          sql`(${candidateId}::uuid, ${reservation.id}::uuid, ${reservation.generation}::integer)`,
      ),
      sql`, `,
    );
    const changed = await this.scope.transaction.db.execute(sql`
      update ${candidates} as candidate
      set occurrence_id = reserved.occurrence_id, generation = reserved.generation, updated_at = clock_timestamp()
      from (values ${values}) as reserved(candidate_id, occurrence_id, generation)
      where candidate.recipient_id = ${recipientId}::uuid
        and candidate.id = reserved.candidate_id
        and candidate.occurrence_id is null
        and candidate.settled_at is null
    `);
    if (changed.rowCount !== batch.length) {
      throw new Error('An activity email candidate changed under its account lock.');
    }
  }

  /** Writes the requested planning job in the same transaction as the candidate changes. */
  public enqueuePlan(userId: string, notBeforeMs: number, runAt?: number): Promise<void> {
    if (this.scope.transaction.kind === 'system') this.scope.requireAccount(userId);
    return this.bindings.enqueuePlan(this.scope.transaction, { userId, notBeforeMs, runAt });
  }

  /** Writes the selected delivery job in the same transaction as its reservation. */
  public enqueueDelivery(
    userId: string,
    reservation: ActivityEmailReservation,
    dueAtMs: number,
  ): Promise<void> {
    const recipientId = this.scope.requireAccount(userId);
    return this.bindings.enqueueDelivery(this.scope.transaction, {
      userId: recipientId,
      occurrenceId: reservation.id,
      generation: reservation.generation,
      runAt: dueAtMs,
    });
  }
  // #endregion
}
