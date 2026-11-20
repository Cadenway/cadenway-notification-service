import { and, asc, eq, gt, isNull, lte, or, sql } from 'drizzle-orm';

import type { ActivityAuthorizationAttempt } from '../../../../../application/models/digest/activity-authorization-attempt.model.js';
import type { ActivityEmailCandidate } from '../../../../../application/models/digest/activity-email-candidate.model.js';
import type { ActivityEmailDelivery } from '../../../../../application/models/digest/activity-email-delivery.model.js';
import type { ActivityDeliveryStore } from '../../../../../application/ports/outbound/transactions/digest/activity-delivery-store.port.js';
import { activityEmailAuthorizationAttempts as attempts } from '../../schemas/digest/activity-email-authorization-attempts.schema.js';
import { activityEmailCandidates as candidates } from '../../schemas/digest/activity-email-candidates.schema.js';
import { activityEmailOccurrences as occurrences } from '../../schemas/digest/activity-email-occurrences.schema.js';
import type {
  ActivityDigestPersistenceBindings,
  ActivityDigestScope,
} from '../../transactions/digest/drizzle-activity-digest.unit-of-work.js';
import {
  maxActivityDigestBatchSize,
  validateActivityDigestBatchSize,
} from './drizzle-activity-email.repository.js';

const databaseTime = sql`clock_timestamp()`;
const noLease = { leaseId: null, leaseUntil: null };

/** Matches a correlation only while its candidate still belongs to that generation. */
const currentCandidate = and(
  eq(candidates.organizationId, attempts.organizationId),
  eq(candidates.recipientId, attempts.recipientId),
  eq(candidates.id, attempts.candidateId),
  eq(candidates.occurrenceId, attempts.occurrenceId),
  eq(candidates.generation, attempts.generation),
  isNull(candidates.settledAt),
);

/** Finds the open candidate binding even when its organization is selected by an account job. */
function candidateBinding(recipientId: string, occurrenceId: string, generation: number) {
  return and(
    eq(candidates.recipientId, recipientId),
    eq(candidates.occurrenceId, occurrenceId),
    eq(candidates.generation, generation),
    isNull(candidates.settledAt),
  );
}

/** Applies state transitions only to the scheduled occurrence owned by the account. */
function scheduledOccurrence(recipientId: string, occurrenceId: string, generation: number) {
  return and(
    eq(occurrences.recipientId, recipientId),
    eq(occurrences.id, occurrenceId),
    eq(occurrences.generation, generation),
    eq(occurrences.state, 'scheduled'),
  );
}

function availableLease() {
  return or(isNull(occurrences.leaseUntil), lte(occurrences.leaseUntil, databaseTime));
}

/** Maps private selectors explicitly so persistence metadata never leaves the store. */
function toCandidate(row: typeof candidates.$inferSelect): ActivityEmailCandidate {
  const {
    organizationId,
    recipientId,
    sourceEventId,
    actorUserId,
    kind,
    taskKey,
    commentId,
    status,
  } = row;
  return {
    organizationId,
    recipientId,
    sourceEventId,
    actorUserId,
    kind,
    taskKey,
    commentId,
    status,
  };
}

/** Owns tenant authorization correlations and account-scoped leases in the active transaction. */
export class DrizzleActivityDelivery implements ActivityDeliveryStore {
  // #region Constructor
  /** Receives current preferences and transaction-aware Task and planning writers. */
  public constructor(
    private readonly scope: ActivityDigestScope,
    private readonly bindings: Pick<
      ActivityDigestPersistenceBindings,
      'readPreferences' | 'writeAuthorization' | 'enqueuePlan'
    >,
  ) {}
  // #endregion

  // #region Methods
  /** Discards superseded correlations by joining to their exact still-open candidate binding. */
  public async lockAttempt(
    organizationId: string,
    attemptId: string,
  ): Promise<ActivityAuthorizationAttempt | null> {
    const tenantId = this.scope.requireTenant(organizationId);
    const [row] = await this.scope.transaction.db
      .select({
        id: attempts.id,
        organizationId: attempts.organizationId,
        expiresAt: attempts.expiresAt,
        outcome: attempts.outcome,
      })
      .from(attempts)
      .innerJoin(candidates, currentCandidate)
      .where(and(eq(attempts.organizationId, tenantId), eq(attempts.id, attemptId)))
      .for('update', { of: [candidates, attempts] });
    return row === undefined ? null : { ...row, expiresAt: row.expiresAt.getTime() };
  }

  /** Records the signed decision once in the tenant transaction that locked its correlation. */
  public async finishAttempt(
    organizationId: string,
    attemptId: string,
    outcome: Exclude<ActivityAuthorizationAttempt['outcome'], 'pending'>,
    validUntil: number,
  ): Promise<void> {
    const tenantId = this.scope.requireTenant(organizationId);
    const deadline = new Date(validUntil);
    const changed = await this.scope.transaction.db
      .update(attempts)
      .set({ outcome, validUntil: deadline, updatedAt: databaseTime })
      .where(
        and(
          eq(attempts.organizationId, tenantId),
          eq(attempts.id, attemptId),
          eq(attempts.outcome, 'pending'),
          outcome === 'expired'
            ? lte(attempts.expiresAt, databaseTime)
            : gt(attempts.expiresAt, databaseTime),
          outcome === 'expired' ? undefined : sql`${deadline}::timestamptz > clock_timestamp()`,
        ),
      )
      .returning({ id: attempts.id });
    if (changed.length !== 1) {
      throw new Error('The activity email authorization expired or changed under its lock.');
    }
  }

  /** Reuses a live request or settled denial and rotates elapsed correlations with a new ID. */
  public async requestAuthorization(
    organizationId: string,
    userId: string,
    occurrenceId: string,
    generation: number,
    expiresAt: number,
  ): Promise<void> {
    const tenantId = this.scope.requireTenant(organizationId);
    const recipientId = userId.toLowerCase();
    await this.scope.lockAccount(recipientId);
    const { db } = this.scope.transaction;
    const rows = await db
      .select({ id: candidates.id, taskKey: candidates.taskKey })
      .from(candidates)
      .where(
        and(
          eq(candidates.organizationId, tenantId),
          candidateBinding(recipientId, occurrenceId, generation),
        ),
      )
      .orderBy(asc(candidates.id))
      .limit(maxActivityDigestBatchSize + 1);
    if (rows.length === 0) return;
    validateActivityDigestBatchSize(rows.length);

    const deadline = new Date(expiresAt);
    const inserted = await db
      .insert(attempts)
      .values(
        rows.map(({ id }) => ({
          organizationId: tenantId,
          recipientId,
          candidateId: id,
          occurrenceId,
          generation,
          expiresAt: deadline,
        })),
      )
      .onConflictDoUpdate({
        target: [
          attempts.organizationId,
          attempts.candidateId,
          attempts.recipientId,
          attempts.occurrenceId,
          attempts.generation,
        ],
        set: {
          id: sql`uuidv7()`,
          outcome: 'pending',
          expiresAt: deadline,
          validUntil: null,
          updatedAt: databaseTime,
        },
        setWhere: or(
          eq(attempts.outcome, 'expired'),
          and(eq(attempts.outcome, 'pending'), lte(attempts.expiresAt, databaseTime)),
          and(eq(attempts.outcome, 'permitted'), lte(attempts.validUntil, databaseTime)),
        ),
      })
      .returning({ attemptId: attempts.id, candidateId: attempts.candidateId });
    const taskKeys = new Map(rows.map(({ id, taskKey }) => [id, taskKey]));
    for (const { attemptId, candidateId } of inserted) {
      const taskKey = taskKeys.get(candidateId);
      if (taskKey === undefined)
        throw new Error('Activity email authorization lost its candidate.');
      await this.bindings.writeAuthorization(this.scope.transaction, {
        attemptId,
        organizationId: tenantId,
        recipientId,
        taskKey,
        expiresAt,
      });
    }
  }

  /** Completes a missing recipient's occurrence only when another sender does not hold it. */
  public async skipRecipient(
    userId: string,
    occurrenceId: string,
    generation: number,
  ): Promise<void> {
    const recipientId = this.scope.requireAccount(userId);
    await this.complete(recipientId, occurrenceId, generation, availableLease());
  }

  /** Leases only a complete bounded page of current decisions and a matching account profile. */
  public async leaseAuthorized(
    userId: string,
    occurrenceId: string,
    generation: number,
    profileVersion: number,
    limit: number,
  ): Promise<ActivityEmailDelivery | null> {
    const recipientId = this.scope.requireAccount(userId);
    validateActivityDigestBatchSize(limit);
    const binding = scheduledOccurrence(recipientId, occurrenceId, generation);
    const { db } = this.scope.transaction;
    const [occurrence] = await db
      .select({
        preferenceVersion: occurrences.preferenceVersion,
        profileVersion: occurrences.profileVersion,
        cadence: occurrences.cadence,
      })
      .from(occurrences)
      .where(and(binding, availableLease(), lte(occurrences.dueAt, databaseTime)))
      .for('update');
    if (occurrence === undefined) return null;

    const preferences = await this.bindings.readPreferences(this.scope.transaction, recipientId);
    if (
      preferences.version !== occurrence.preferenceVersion ||
      preferences.cadence !== occurrence.cadence ||
      profileVersion !== occurrence.profileVersion
    ) {
      await this.supersede(recipientId, occurrenceId, generation);
      return null;
    }
    const rows = await db
      .select({
        candidate: candidates,
        outcome: attempts.outcome,
        validUntil: attempts.validUntil,
        live: sql<boolean>`${attempts.validUntil} > clock_timestamp()`,
      })
      .from(candidates)
      .leftJoin(attempts, currentCandidate)
      .where(candidateBinding(recipientId, occurrenceId, generation))
      .orderBy(asc(candidates.id))
      .limit(limit + 1);
    if (rows.length > limit)
      throw new Error('The activity email occurrence exceeds its lease bound.');

    const items: ActivityEmailDelivery['items'][number][] = [];
    for (const row of rows) {
      const candidate = toCandidate(row.candidate);
      if (!preferences.enabled[candidate.kind]) continue;
      if (row.outcome === 'denied' && row.validUntil !== null) {
        items.push({ candidate, decision: 'deny', validUntil: row.validUntil.getTime() });
      } else if (row.outcome === 'permitted' && row.live && row.validUntil !== null) {
        items.push({ candidate, decision: 'permit', validUntil: row.validUntil.getTime() });
      } else {
        return null;
      }
    }

    const [lease] = await db
      .update(occurrences)
      .set({
        leaseId: sql`uuidv7()`,
        leaseUntil: sql`clock_timestamp() + interval '60 seconds'`,
        updatedAt: databaseTime,
      })
      .where(and(binding, availableLease()))
      .returning({ id: occurrences.leaseId });
    if (lease?.id == null)
      throw new Error('The activity email lease changed under its account lock.');
    return {
      occurrenceId,
      generation,
      leaseId: lease.id,
      recipientId,
      profileVersion,
      preferencesVersion: preferences.version,
      items,
    };
  }

  /** Consumes the occurrence only while the corresponding lease is live. */
  public finish(
    userId: string,
    occurrenceId: string,
    generation: number,
    leaseId: string,
  ): Promise<boolean> {
    const recipientId = this.scope.requireAccount(userId);
    return this.complete(
      recipientId,
      occurrenceId,
      generation,
      and(eq(occurrences.leaseId, leaseId), gt(occurrences.leaseUntil, databaseTime)),
    );
  }

  /** Releases only this worker's matching lease so it cannot overwrite a later retry. */
  public async release(
    userId: string,
    occurrenceId: string,
    generation: number,
    leaseId: string,
  ): Promise<void> {
    const recipientId = this.scope.requireAccount(userId);
    await this.scope.transaction.db
      .update(occurrences)
      .set({ ...noLease, updatedAt: databaseTime })
      .where(
        and(
          scheduledOccurrence(recipientId, occurrenceId, generation),
          eq(occurrences.leaseId, leaseId),
        ),
      );
  }

  /** Marks only the still-current occurrence's candidates consumed. */
  private async complete(
    recipientId: string,
    occurrenceId: string,
    generation: number,
    guard: ReturnType<typeof and>,
  ): Promise<boolean> {
    const { db } = this.scope.transaction;
    const changed = await db
      .update(occurrences)
      .set({ ...noLease, state: 'completed', updatedAt: databaseTime })
      .where(and(scheduledOccurrence(recipientId, occurrenceId, generation), guard))
      .returning({ id: occurrences.id });
    if (changed.length === 0) return false;
    await db
      .update(candidates)
      .set({ settledAt: databaseTime, updatedAt: databaseTime })
      .where(candidateBinding(recipientId, occurrenceId, generation));
    return true;
  }

  /** Detaches the previous generation and enqueues one replanning job atomically. */
  private async supersede(
    recipientId: string,
    occurrenceId: string,
    generation: number,
  ): Promise<void> {
    const { db } = this.scope.transaction;
    const changed = await db
      .update(occurrences)
      .set({
        ...noLease,
        state: 'superseded',
        generation: sql`${occurrences.generation} + 1`,
        updatedAt: databaseTime,
      })
      .where(and(scheduledOccurrence(recipientId, occurrenceId, generation), availableLease()))
      .returning({ id: occurrences.id });
    if (changed.length !== 1)
      throw new Error('The activity email occurrence changed under its account lock.');
    await db
      .update(candidates)
      .set({ occurrenceId: null, generation: null, updatedAt: databaseTime })
      .where(candidateBinding(recipientId, occurrenceId, generation));
    await this.bindings.enqueuePlan(this.scope.transaction, {
      userId: recipientId,
      notBeforeMs: Date.now(),
    });
  }
  // #endregion
}
