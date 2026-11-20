import type { TransactionScope } from '@cadenway/nest-common/database';
import { and, eq, sql } from 'drizzle-orm';

import type { ReminderAuthorizationAttempt } from '../../../../../application/models/reminder/reminder-authorization-attempt.model.js';
import type { ReminderAuthorizationRetry } from '../../../../../application/models/reminder/reminder-authorization-retry.model.js';
import type { ReminderAuthorizationStore } from '../../../../../application/ports/outbound/transactions/reminder/reminder-authorization-store.port.js';
import { Reminder } from '../../../../../domain/aggregates/reminder/reminder.aggregate.js';
import type { ReminderDue } from '../../../../../domain/events/reminder/reminder-due.event.js';
import { reminderAuthorizationAttempts } from '../../schemas/reminder/reminder-authorization-attempts.schema.js';
import { reminders } from '../../schemas/reminder/reminders.schema.js';
import { DrizzleReminderGeneration } from './drizzle-reminder-generation.repository.js';
import { DrizzleReminderRecords } from './drizzle-reminder-records.repository.js';

type RequestWriter = (attempt: ReminderAuthorizationAttempt) => Promise<void>;
type DueWriter = (fact: ReminderDue) => Promise<void>;
type AttemptRow = typeof reminderAuthorizationAttempts.$inferSelect;
type ReminderRow = typeof reminders.$inferSelect;

function attemptFromRow(row: AttemptRow): ReminderAuthorizationAttempt {
  if (
    row.status !== 'pending' &&
    row.status !== 'permitted' &&
    row.status !== 'denied' &&
    row.status !== 'expired'
  ) {
    throw new Error('Invalid persisted reminder authorization status.');
  }
  return { ...row, status: row.status, expiresAt: row.expiresAt.getTime() };
}

function reminderFromRow(row: ReminderRow): Reminder {
  return Reminder.restore({
    ...row,
    createdAt: row.createdAt.getTime(),
    remindAt: row.remindAt.getTime(),
    firedAt: row.firedAt?.getTime() ?? null,
    completedAt: row.completedAt?.getTime() ?? null,
  });
}

/** Persists a reminder authorization lifecycle inside the caller's tenant transaction. */
export class DrizzleReminderAuthorization implements ReminderAuthorizationStore {
  // #region Constructor
  /** Binds the transaction and outbox writers. */
  public constructor(
    private readonly scope: TransactionScope,
    private readonly tenant: string,
    private readonly writeRequest: RequestWriter,
    private readonly writeDue: DueWriter,
    private readonly enqueueRetry: (retry: ReminderAuthorizationRetry) => Promise<void>,
  ) {}
  // #endregion

  // #region Methods
  /** Allocates a PostgreSQL UUID only when the locked reminder needs a new attempt. */
  public allocateAttemptId(): Promise<string> {
    return new DrizzleReminderRecords(this.scope, this.tenant).newId();
  }

  /** Reads an immutable locator without a lock; the caller then locks the reminder first. */
  public async findAttempt(
    organizationId: string,
    attemptId: string,
  ): Promise<ReminderAuthorizationAttempt | null> {
    this.requireTenant(organizationId);
    const rows = await this.scope.db
      .select()
      .from(reminderAuthorizationAttempts)
      .where(
        and(
          eq(reminderAuthorizationAttempts.organizationId, this.tenant),
          eq(reminderAuthorizationAttempts.id, attemptId),
        ),
      )
      .limit(1);
    return rows[0] === undefined ? null : attemptFromRow(rows[0]);
  }

  /** Locks the reminder using its tenant and owner before any attempt lock. */
  public async lockReminder(
    organizationId: string,
    userId: string,
    reminderId: string,
  ): Promise<Reminder | null> {
    this.requireTenant(organizationId);
    await new DrizzleReminderGeneration(this.scope, this.tenant).lock(userId);
    const rows = await this.scope.db
      .select()
      .from(reminders)
      .where(
        and(
          eq(reminders.organizationId, this.tenant),
          eq(reminders.userId, userId),
          eq(reminders.id, reminderId),
        ),
      )
      .limit(1)
      .for('update');
    return rows[0] === undefined ? null : reminderFromRow(rows[0]);
  }

  /** Locks the sole current attempt after its reminder has been locked. */
  public async lockCurrentAttempt(
    organizationId: string,
    reminderId: string,
  ): Promise<ReminderAuthorizationAttempt | null> {
    this.requireTenant(organizationId);
    const rows = await this.scope.db
      .select()
      .from(reminderAuthorizationAttempts)
      .where(
        and(
          eq(reminderAuthorizationAttempts.organizationId, this.tenant),
          eq(reminderAuthorizationAttempts.reminderId, reminderId),
          eq(reminderAuthorizationAttempts.current, true),
        ),
      )
      .limit(1)
      .for('update');
    return rows[0] === undefined ? null : attemptFromRow(rows[0]);
  }

  /** Replaces the current attempt and records the new request in the same transaction. */
  public async requestAuthorization(attempt: ReminderAuthorizationAttempt): Promise<void> {
    this.requireTenant(attempt.organizationId);
    await this.scope.db
      .update(reminderAuthorizationAttempts)
      .set({ current: false })
      .where(
        and(
          eq(reminderAuthorizationAttempts.organizationId, this.tenant),
          eq(reminderAuthorizationAttempts.reminderId, attempt.reminderId),
          eq(reminderAuthorizationAttempts.current, true),
        ),
      );
    await this.scope.db
      .insert(reminderAuthorizationAttempts)
      .values({ ...attempt, expiresAt: new Date(attempt.expiresAt), current: true });
    await this.writeRequest(attempt);
  }

  /** Enqueues the follow-up using the caller's active tenant transaction. */
  public scheduleRetry(retry: ReminderAuthorizationRetry): Promise<void> {
    this.requireTenant(retry.organizationId);
    return this.enqueueRetry(retry);
  }

  /** Stores a terminal outcome once on the current pending attempt. */
  public async finishAttempt(
    organizationId: string,
    attemptId: string,
    status: 'permitted' | 'denied' | 'expired',
  ): Promise<void> {
    this.requireTenant(organizationId);
    const rows = await this.scope.db
      .update(reminderAuthorizationAttempts)
      .set({ status })
      .where(
        and(
          eq(reminderAuthorizationAttempts.organizationId, this.tenant),
          eq(reminderAuthorizationAttempts.id, attemptId),
          eq(reminderAuthorizationAttempts.current, true),
          eq(reminderAuthorizationAttempts.status, 'pending'),
        ),
      )
      .returning({ id: reminderAuthorizationAttempts.id });
    if (rows.length !== 1) throw new Error('The locked authorization attempt changed.');
  }

  /** Saves exactly the next aggregate version while retaining the tenant and owner binding. */
  public async save(reminder: Reminder): Promise<void> {
    const state = reminder.snapshot;
    this.requireTenant(state.organizationId);
    const rows = await this.scope.db
      .update(reminders)
      .set({
        remindAt: new Date(state.remindAt),
        note: state.note,
        firedAt: state.firedAt === null ? null : new Date(state.firedAt),
        completedAt: state.completedAt === null ? null : new Date(state.completedAt),
        version: state.version,
        scheduleVersion: state.scheduleVersion,
        updatedAt: sql`greatest(${reminders.updatedAt}, now())`,
      })
      .where(
        and(
          eq(reminders.organizationId, this.tenant),
          eq(reminders.userId, state.userId),
          eq(reminders.id, state.id),
          eq(reminders.taskId, state.taskId),
          eq(reminders.version, state.version - 1),
        ),
      )
      .returning({ id: reminders.id });
    if (rows.length !== 1) throw new Error('The locked reminder version changed.');
    await new DrizzleReminderGeneration(this.scope, this.tenant).advance(state.userId);
  }

  /** Writes the due fact using the same database transaction. */
  public async recordDue(fact: ReminderDue): Promise<void> {
    this.requireTenant(fact.organizationId);
    await this.writeDue(fact);
  }

  /** Rejects a scope inconsistent with the tenant established by the runner. */
  private requireTenant(organizationId: string): void {
    if (organizationId.toLowerCase() !== this.tenant)
      throw new Error('Reminder tenant scope mismatch.');
  }
  // #endregion
}
