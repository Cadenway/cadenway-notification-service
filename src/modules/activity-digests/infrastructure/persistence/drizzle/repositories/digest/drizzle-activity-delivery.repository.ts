import { and, asc, eq, gt, isNull, lte, or, sql } from 'drizzle-orm';

import type { ActivityAuthorizationAttempt } from '../../../../../application/models/digest/activity-authorization-attempt.model.js';
import type { ActivityAuthorizationCandidate } from '../../../../../application/models/digest/activity-authorization-candidate.model.js';
import type { ActivityDeliveryDecision } from '../../../../../application/models/digest/activity-delivery-decision.model.js';
import type { ActivityEmailDelivery } from '../../../../../application/models/digest/activity-email-delivery.model.js';
import type { ActivityEmailPreferences } from '../../../../../application/models/digest/activity-email-preferences.model.js';
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

function activeLease(leaseId: string) {
  return and(eq(occurrences.leaseId, leaseId), gt(occurrences.leaseUntil, databaseTime));
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

  /** Serializes tenant requests with account mutations and reads only current candidate bindings. */
  public async listAuthorizationCandidates(
    organizationId: string,
    userId: string,
    occurrenceId: string,
    generation: number,
  ): Promise<readonly ActivityAuthorizationCandidate[]> {
    const tenantId = this.scope.requireTenant(organizationId);
    const recipientId = userId.toLowerCase();
    await this.scope.lockAccount(recipientId);
    const rows = await this.scope.transaction.db
      .select({
        candidateId: candidates.id,
        taskKey: candidates.taskKey,
        outcome: attempts.outcome,
        expiresAt: attempts.expiresAt,
        validUntil: attempts.validUntil,
      })
      .from(candidates)
      .leftJoin(attempts, currentCandidate)
      .where(
        and(
          eq(candidates.organizationId, tenantId),
          candidateBinding(recipientId, occurrenceId, generation),
        ),
      )
      .orderBy(asc(candidates.id))
      .limit(maxActivityDigestBatchSize + 1);
    if (rows.length > maxActivityDigestBatchSize) {
      throw new Error('The activity email occurrence exceeds its authorization bound.');
    }
    return rows.map((row) => ({
      ...row,
      expiresAt: row.expiresAt?.getTime() ?? null,
      validUntil: row.validUntil?.getTime() ?? null,
    }));
  }

  /** Changes the correlation only while its persisted deadline or expiry permits rotation. */
  public async reserveAuthorizationAttempts(
    organizationId: string,
    userId: string,
    occurrenceId: string,
    generation: number,
    expiresAt: number,
    candidateIds: readonly string[],
  ): Promise<readonly { readonly attemptId: string; readonly candidateId: string }[]> {
    const tenantId = this.scope.requireTenant(organizationId);
    const recipientId = userId.toLowerCase();
    validateActivityDigestBatchSize(candidateIds.length);
    const deadline = new Date(expiresAt);
    return this.scope.transaction.db
      .insert(attempts)
      .values(
        candidateIds.map((candidateId) => ({
          organizationId: tenantId,
          recipientId,
          candidateId,
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
  }

  /** Resolves the verified tenant before appending the outbox event. */
  public appendAuthorization(
    request: Parameters<ActivityDeliveryStore['appendAuthorization']>[0],
  ): Promise<void> {
    const organizationId = this.scope.requireTenant(request.organizationId);
    return this.bindings.writeAuthorization(this.scope.transaction, {
      ...request,
      organizationId,
      recipientId: request.recipientId.toLowerCase(),
    });
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

  /** Locks exactly the requested generation once due and free of a live lease. */
  public async lockDueOccurrence(
    userId: string,
    occurrenceId: string,
    generation: number,
  ): Promise<ActivityEmailDelivery | null> {
    const recipientId = this.scope.requireAccount(userId);
    const binding = scheduledOccurrence(recipientId, occurrenceId, generation);
    const [row] = await this.scope.transaction.db
      .select({
        occurrenceId: occurrences.id,
        generation: occurrences.generation,
        recipientId: occurrences.recipientId,
        profileVersion: occurrences.profileVersion,
        cadence: occurrences.cadence,
      })
      .from(occurrences)
      .where(and(binding, availableLease(), lte(occurrences.dueAt, databaseTime)))
      .for('update');
    return row ?? null;
  }

  /** Uses the account bound by the system work before reading preferences. */
  public readPreferences(userId: string): Promise<ActivityEmailPreferences> {
    const recipientId = this.scope.requireAccount(userId);
    return this.bindings.readPreferences(this.scope.transaction, recipientId);
  }

  /** Maps authorization state without deciding whether the candidate can be emailed. */
  public async listDeliveryDecisions(
    userId: string,
    occurrenceId: string,
    generation: number,
  ): Promise<readonly ActivityDeliveryDecision[]> {
    const recipientId = this.scope.requireAccount(userId);
    const rows = await this.scope.transaction.db
      .select({
        recipientId: candidates.recipientId,
        kind: candidates.kind,
        outcome: attempts.outcome,
        validUntil: attempts.validUntil,
      })
      .from(candidates)
      .leftJoin(attempts, currentCandidate)
      .where(candidateBinding(recipientId, occurrenceId, generation))
      .orderBy(asc(candidates.id))
      .limit(maxActivityDigestBatchSize + 1);
    if (rows.length > maxActivityDigestBatchSize) {
      throw new Error('The activity email occurrence exceeds its lease bound.');
    }
    return rows.map((row) => ({ ...row, validUntil: row.validUntil?.getTime() ?? null }));
  }

  /** Uses database time to record a new lease and its exclusive deadline. */
  public async claim(
    userId: string,
    occurrenceId: string,
    generation: number,
  ): Promise<{ readonly id: string; readonly validUntil: number }> {
    const recipientId = this.scope.requireAccount(userId);
    const binding = scheduledOccurrence(recipientId, occurrenceId, generation);
    const [lease] = await this.scope.transaction.db
      .update(occurrences)
      .set({
        leaseId: sql`uuidv7()`,
        leaseUntil: sql`clock_timestamp() + interval '60 seconds'`,
        updatedAt: databaseTime,
      })
      .where(and(binding, availableLease(), lte(occurrences.dueAt, databaseTime)))
      .returning({ id: occurrences.leaseId, until: occurrences.leaseUntil });
    if (lease?.id == null || lease.until === null) {
      throw new Error('The activity email lease changed under its account lock.');
    }
    return { id: lease.id, validUntil: lease.until.getTime() };
  }

  /** Consumes the occurrence only while the corresponding lease is live. */
  public finish(
    userId: string,
    occurrenceId: string,
    generation: number,
    leaseId: string,
  ): Promise<boolean> {
    const recipientId = this.scope.requireAccount(userId);
    return this.complete(recipientId, occurrenceId, generation, activeLease(leaseId));
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

  /** Detaches only the generation whose unleased state or owned live lease still holds. */
  public async supersede(
    userId: string,
    occurrenceId: string,
    generation: number,
    leaseId?: string,
  ): Promise<boolean> {
    const recipientId = this.scope.requireAccount(userId);
    const { db } = this.scope.transaction;
    const guard = leaseId === undefined ? availableLease() : activeLease(leaseId);
    const changed = await db
      .update(occurrences)
      .set({
        ...noLease,
        state: 'superseded',
        generation: sql`${occurrences.generation} + 1`,
        updatedAt: databaseTime,
      })
      .where(and(scheduledOccurrence(recipientId, occurrenceId, generation), guard))
      .returning({ id: occurrences.id });
    if (changed.length === 0) return false;
    await db
      .update(candidates)
      .set({ occurrenceId: null, generation: null, updatedAt: databaseTime })
      .where(candidateBinding(recipientId, occurrenceId, generation));
    return true;
  }

  /** Bridges the application-selected planning job into its current transaction. */
  public enqueuePlan(userId: string, notBeforeMs: number): Promise<void> {
    const recipientId = this.scope.requireAccount(userId);
    return this.bindings.enqueuePlan(this.scope.transaction, { userId: recipientId, notBeforeMs });
  }
  // #endregion
}
