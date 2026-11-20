import { and, asc, desc, eq, gt, inArray, isNull, lte, sql } from 'drizzle-orm';

import type { ActivityEmailCandidate } from '../../../../../application/models/digest/activity-email-candidate.model.js';
import type { ActivityEmailPreferences } from '../../../../../application/models/digest/activity-email-preferences.model.js';
import type { ActivityEmailStore } from '../../../../../application/ports/outbound/transactions/digest/activity-email-store.port.js';
import type { ActivityEmailOccurrence } from '../../../../../domain/value-objects/digest/activity-email-occurrence.value-object.js';
import { activityEmailCandidates as candidates } from '../../schemas/digest/activity-email-candidates.schema.js';
import { activityEmailOccurrences as occurrences } from '../../schemas/digest/activity-email-occurrences.schema.js';
import type {
  ActivityDigestPersistenceBindings,
  ActivityDigestScope,
} from '../../transactions/digest/drizzle-activity-digest.unit-of-work.js';

type ScheduleValues = Pick<
  typeof occurrences.$inferSelect,
  'recipientId' | 'dueAt' | 'preferenceVersion' | 'profileVersion'
>;
interface Reservation {
  // #region Properties
  /** Stable identifiers and whether this assignment reserved a new job. */
  readonly candidateId: string;
  readonly occurrenceId: string;
  readonly generation: number;
  readonly enqueue: boolean;
  // #endregion
}

const insertBatchSize = 250;

/** Caps account work and tenant fan-out for a single occurrence. */
export const maxActivityDigestBatchSize: number = 100;

/** Checks explicit bounds before emitting a LIMIT. */
export function validateActivityDigestBatchSize(limit: number): void {
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > maxActivityDigestBatchSize) {
    throw new RangeError('Activity email page size must be between 1 and 100.');
  }
}

/** Binds candidates to a stable occurrence and its current generation. */
function assignment(
  ids: readonly string[],
  occurrence: { readonly id: string; readonly generation: number },
  enqueue: boolean,
): Reservation[] {
  return ids.map((candidateId) => ({
    candidateId,
    occurrenceId: occurrence.id,
    generation: occurrence.generation,
    enqueue,
  }));
}

/** Stages immutable candidates and assigns bounded account batches in the caller's transaction. */
export class DrizzleActivityEmail implements ActivityEmailStore {
  // #region Constructor
  /** Binds scheduling and job writes to one account or tenant transaction. */
  public constructor(
    private readonly scope: ActivityDigestScope,
    private readonly bindings: Pick<
      ActivityDigestPersistenceBindings,
      'readPreferences' | 'enqueuePlan' | 'enqueueDelivery'
    >,
  ) {}
  // #endregion

  // #region Methods
  /** Inserts each source-recipient pair once and schedules planning for newly inserted accounts. */
  public async stage(
    organizationId: string,
    values: readonly ActivityEmailCandidate[],
  ): Promise<number> {
    const tenantId = this.scope.requireTenant(organizationId);
    if (values.some((value) => value.organizationId.toLowerCase() !== tenantId)) {
      throw new Error('Activity email candidate belongs to another organization.');
    }
    const { db } = this.scope.transaction;
    // Several source facts can name overlapping recipients. Acquire preference locks in UUID order.
    const ordered = [...values].sort((left, right) =>
      left.recipientId.localeCompare(right.recipientId),
    );
    const eligible: ActivityEmailCandidate[] = [];
    for (const value of ordered) {
      const preferences = await this.bindings.readPreferences(
        this.scope.transaction,
        value.recipientId,
      );
      if (preferences.cadence !== 'never' && preferences.enabled[value.kind]) eligible.push(value);
    }
    const notBeforeMs = Date.now();
    let staged = 0;
    for (let index = 0; index < eligible.length; index += insertBatchSize) {
      const inserted = await db
        .insert(candidates)
        .values(eligible.slice(index, index + insertBatchSize))
        .onConflictDoNothing({
          target: [candidates.organizationId, candidates.recipientId, candidates.sourceEventId],
        })
        .returning({ userId: candidates.recipientId });
      for (const { userId } of inserted) {
        await this.bindings.enqueuePlan(this.scope.transaction, { userId, notBeforeMs });
      }
      staged += inserted.length;
    }
    return staged;
  }

  /** Reads the current email choices under the bound account and preference transaction locks. */
  public lockPreferences(userId: string): Promise<ActivityEmailPreferences> {
    return this.bindings.readPreferences(this.scope.transaction, this.scope.requireAccount(userId));
  }

  /** Reserves only unassigned eligible candidates and writes their delivery jobs atomically. */
  public async schedule(
    userId: string,
    preferences: ActivityEmailPreferences,
    occurrence: ActivityEmailOccurrence,
    limit: number,
  ): Promise<number> {
    const recipientId = this.scope.requireAccount(userId);
    validateActivityDigestBatchSize(limit);
    if (preferences.cadence !== occurrence.cadence) {
      throw new Error('Activity email occurrence does not match the locked cadence.');
    }
    const kinds = (Object.keys(preferences.enabled) as ActivityEmailCandidate['kind'][]).filter(
      (kind) => preferences.enabled[kind],
    );
    if (kinds.length === 0) return 0;

    const { db } = this.scope.transaction;
    const dueAt = new Date(occurrence.dueAtMs);
    const selected = await db
      .select({ id: candidates.id })
      .from(candidates)
      .where(
        and(
          eq(candidates.recipientId, recipientId),
          isNull(candidates.occurrenceId),
          isNull(candidates.settledAt),
          inArray(candidates.kind, kinds),
          occurrence.cadence === 'each' ? undefined : lte(candidates.createdAt, dueAt),
        ),
      )
      .orderBy(asc(candidates.createdAt), asc(candidates.id))
      .limit(limit + 1);
    if (selected.length === 0) return 0;

    const ids = selected.slice(0, limit).map(({ id }) => id);
    const values = {
      recipientId,
      dueAt,
      preferenceVersion: preferences.version,
      profileVersion: occurrence.profileVersion,
    };
    const batches =
      occurrence.cadence === 'each'
        ? await this.reserveIndividuals(values, ids)
        : await this.reserveDigest(values, occurrence.cadence, occurrence.localDate, ids);
    await this.assign(recipientId, batches);

    const jobs = new Map(
      batches.filter((row) => row.enqueue).map((row) => [row.occurrenceId, row.generation]),
    );
    for (const [occurrenceId, generation] of jobs) {
      await this.bindings.enqueueDelivery(this.scope.transaction, {
        userId: recipientId,
        occurrenceId,
        generation,
        runAt: occurrence.dueAtMs,
      });
    }
    if (selected.length > limit) {
      await this.bindings.enqueuePlan(this.scope.transaction, {
        userId: recipientId,
        notBeforeMs: occurrence.dueAtMs,
      });
    }
    return jobs.size;
  }

  /** Keeps an immediate occurrence's identity even when its generation needs a new profile. */
  private async reserveIndividuals(
    values: ScheduleValues,
    ids: readonly string[],
  ): Promise<readonly Reservation[]> {
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
      return { candidateId: individualCandidateId, occurrenceId: id, generation, enqueue: true };
    });
  }

  /** Extends today's open batch and allocates new work only when it cannot hold the page. */
  private async reserveDigest(
    values: ScheduleValues,
    cadence: 'daily' | 'weekly',
    localDate: string,
    ids: readonly string[],
  ): Promise<readonly Reservation[]> {
    const { db } = this.scope.transaction;
    const epoch = and(
      eq(occurrences.recipientId, values.recipientId),
      eq(occurrences.cadence, cadence),
      eq(occurrences.localDate, localDate),
    );
    const [active] = await db
      .select({ id: occurrences.id, generation: occurrences.generation })
      .from(occurrences)
      .where(
        and(
          epoch,
          eq(occurrences.state, 'scheduled'),
          eq(occurrences.preferenceVersion, values.preferenceVersion),
          eq(occurrences.profileVersion, values.profileVersion),
          eq(occurrences.dueAt, values.dueAt),
          gt(occurrences.dueAt, sql`clock_timestamp()`),
          isNull(occurrences.leaseId),
        ),
      )
      .orderBy(desc(occurrences.batchNumber))
      .limit(1);
    const reserved: Reservation[] = [];
    if (active !== undefined) {
      const assigned = await db
        .select({ id: candidates.id })
        .from(candidates)
        .where(
          and(
            eq(candidates.recipientId, values.recipientId),
            eq(candidates.occurrenceId, active.id),
            eq(candidates.generation, active.generation),
          ),
        )
        .limit(maxActivityDigestBatchSize + 1);
      validateActivityDigestBatchSize(assigned.length);
      const capacity = maxActivityDigestBatchSize - assigned.length;
      reserved.push(...assignment(ids.slice(0, capacity), active, false));
    }
    const remaining = ids.slice(reserved.length);
    if (remaining.length === 0) return reserved;

    const [previous] = await db
      .select({ id: occurrences.id })
      .from(occurrences)
      .where(and(epoch, eq(occurrences.state, 'superseded')))
      .orderBy(asc(occurrences.batchNumber))
      .limit(1);
    if (previous !== undefined) {
      const [reopened] = await db
        .update(occurrences)
        .set({ ...values, state: 'scheduled', updatedAt: sql`clock_timestamp()` })
        .where(and(epoch, eq(occurrences.id, previous.id), eq(occurrences.state, 'superseded')))
        .returning({ id: occurrences.id, generation: occurrences.generation });
      if (reopened === undefined)
        throw new Error('The activity email batch changed under its account lock.');
      return [...reserved, ...assignment(remaining, reopened, true)];
    }

    const [last] = await db
      .select({ batchNumber: occurrences.batchNumber })
      .from(occurrences)
      .where(epoch)
      .orderBy(desc(occurrences.batchNumber))
      .limit(1);
    const [inserted] = await db
      .insert(occurrences)
      .values({ ...values, cadence, localDate, batchNumber: (last?.batchNumber ?? 0) + 1 })
      .returning({ id: occurrences.id, generation: occurrences.generation });
    if (inserted === undefined) throw new Error('The activity email batch was not reserved.');
    return [...reserved, ...assignment(remaining, inserted, true)];
  }

  /** Assigns the complete page in one statement and verifies that no candidate was already claimed. */
  private async assign(recipientId: string, batch: readonly Reservation[]): Promise<void> {
    const values = sql.join(
      batch.map(
        (row) =>
          sql`(${row.candidateId}::uuid, ${row.occurrenceId}::uuid, ${row.generation}::integer)`,
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
  // #endregion
}
