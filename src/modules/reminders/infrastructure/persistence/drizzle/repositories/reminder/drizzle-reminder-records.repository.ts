import type { TransactionScope } from '@cadenway/nest-common/database';
import { and, asc, eq, gt, inArray, isNull, or, sql } from 'drizzle-orm';

import { Reminder } from '../../../../../domain/aggregates/reminder/reminder.aggregate.js';
import { reminders } from '../../schemas/reminder/reminders.schema.js';
import { DrizzleReminderGeneration } from './drizzle-reminder-generation.repository.js';

type ReminderRow = typeof reminders.$inferSelect;

function restore(row: ReminderRow): Reminder {
  return Reminder.restore({
    ...row,
    createdAt: row.createdAt.getTime(),
    remindAt: row.remindAt.getTime(),
    firedAt: row.firedAt?.getTime() ?? null,
    completedAt: row.completedAt?.getTime() ?? null,
  });
}

/** Owner-scoped reminder primitives, pending Gateway visibility integration. */
export class DrizzleReminderRecords {
  // #region Constructor
  /** Binds one verified tenant transaction. */
  public constructor(
    private readonly scope: TransactionScope,
    private readonly tenant: string,
  ) {
    if (scope.organizationId?.toLowerCase() !== tenant)
      throw new Error('Reminder tenant scope mismatch.');
  }
  // #endregion

  // #region Methods
  /** Serializes first insertion and updates of a personal task slot. */
  public async lockTaskSlot(userId: string, taskId: string): Promise<void> {
    await new DrizzleReminderGeneration(this.scope, this.tenant).lock(userId);
    const key = `reminders:${this.tenant}:${userId.toLowerCase()}:${taskId.toLowerCase()}`;
    await this.scope.db.execute(sql`select pg_advisory_xact_lock(hashtextextended(${key}, 0))`);
  }

  /** Allocates the PostgreSQL-generated UUID for a new reminder. */
  public async newId(): Promise<string> {
    const rows = await this.scope.db.execute<{ id: string }>(sql`select uuidv7() as id`);
    const row = rows.rows[0];
    if (row === undefined) throw new Error('PostgreSQL did not allocate a reminder ID.');
    return row.id;
  }

  /** Reads the current personal slot, optionally under its previously acquired slot lock. */
  public async findPending(userId: string, taskId: string, lock = true): Promise<Reminder | null> {
    const query = this.scope.db
      .select()
      .from(reminders)
      .where(
        and(
          eq(reminders.organizationId, this.tenant),
          eq(reminders.userId, userId),
          eq(reminders.taskId, taskId),
          isNull(reminders.completedAt),
        ),
      )
      .limit(1);
    const rows = lock ? await query.for('update') : await query;
    return rows[0] === undefined ? null : restore(rows[0]);
  }

  /** Inserts a new reminder after locking its personal slot. */
  public async insert(reminder: Reminder): Promise<void> {
    const state = reminder.snapshot;
    if (state.organizationId.toLowerCase() !== this.tenant || state.version !== 1) {
      throw new Error('New reminder has an invalid tenant or version.');
    }
    const generation = new DrizzleReminderGeneration(this.scope, this.tenant);
    await generation.lock(state.userId);
    await this.scope.db.insert(reminders).values({
      ...state,
      createdAt: new Date(state.createdAt),
      updatedAt: new Date(state.createdAt),
      remindAt: new Date(state.remindAt),
      firedAt: state.firedAt === null ? null : new Date(state.firedAt),
      completedAt: state.completedAt === null ? null : new Date(state.completedAt),
    });
    await generation.advance(state.userId);
  }

  /** Loads an owned reminder, taking the owner lock first for a mutation. */
  public async findById(userId: string, id: string, lock: boolean): Promise<Reminder | null> {
    if (lock) await new DrizzleReminderGeneration(this.scope, this.tenant).lock(userId);
    const query = this.scope.db
      .select()
      .from(reminders)
      .where(
        and(
          eq(reminders.organizationId, this.tenant),
          eq(reminders.userId, userId),
          eq(reminders.id, id),
        ),
      )
      .limit(1);
    const rows = lock ? await query.for('update') : await query;
    return rows[0] === undefined ? null : restore(rows[0]);
  }

  /** Inserts a new record or stores an exact next version after the appropriate locks. */
  public async save(reminder: Reminder): Promise<void> {
    const state = reminder.snapshot;
    if (state.organizationId.toLowerCase() !== this.tenant)
      throw new Error('Reminder tenant scope mismatch.');
    if (state.version === 1) {
      await this.insert(reminder);
      return;
    }
    const generation = new DrizzleReminderGeneration(this.scope, this.tenant);
    await generation.lock(state.userId);
    const changed = await this.scope.db
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
    if (changed.length !== 1) throw new Error('The locked reminder version changed.');
    await generation.advance(state.userId);
  }

  /** Deletes an exact owner and version while holding the owner and reminder locks. */
  public async remove(reminder: Reminder): Promise<void> {
    const state = reminder.snapshot;
    if (state.organizationId.toLowerCase() !== this.tenant)
      throw new Error('Reminder tenant scope mismatch.');
    const generation = new DrizzleReminderGeneration(this.scope, this.tenant);
    await generation.lock(state.userId);
    const deleted = await this.scope.db
      .delete(reminders)
      .where(
        and(
          eq(reminders.organizationId, this.tenant),
          eq(reminders.userId, state.userId),
          eq(reminders.id, state.id),
          eq(reminders.taskId, state.taskId),
          eq(reminders.version, state.version),
        ),
      )
      .returning({ id: reminders.id });
    if (deleted.length !== 1) throw new Error('The locked reminder version changed.');
    await generation.advance(state.userId);
  }

  /** Reads an owner-scoped bounded page of candidates before Gateway visibility checks. */
  public async page(
    userId: string,
    limit: number,
    after: { readonly remindAt: number; readonly id: string } | null,
  ): Promise<readonly Reminder[]> {
    if (!Number.isInteger(limit) || limit < 1 || limit > 101)
      throw new RangeError('Reminder page limit must be between 1 and 101.');
    const cursorTime = after === null ? null : new Date(after.remindAt);
    const rows = await this.scope.db
      .select()
      .from(reminders)
      .where(
        and(
          eq(reminders.organizationId, this.tenant),
          eq(reminders.userId, userId),
          isNull(reminders.completedAt),
          after === null || cursorTime === null
            ? undefined
            : or(
                gt(reminders.remindAt, cursorTime),
                and(eq(reminders.remindAt, cursorTime), gt(reminders.id, after.id)),
              ),
        ),
      )
      .orderBy(asc(reminders.remindAt), asc(reminders.id))
      .limit(limit);
    return rows.map(restore);
  }

  /** Reads a bounded page in the caller's read-only repeatable-read snapshot. */
  public async pageAtGeneration(
    userId: string,
    expected: string | null,
    limit: number,
    after: { readonly remindAt: number; readonly id: string } | null,
  ): Promise<{ readonly generation: string; readonly items: readonly Reminder[] }> {
    const generation = new DrizzleReminderGeneration(this.scope, this.tenant);
    const current = await generation.verify(userId, expected);
    return { generation: current.toString(), items: await this.page(userId, limit, after) };
  }

  /** Reads checked pairs in request order in the caller's repeatable-read snapshot. */
  public async selectedAtGeneration(
    userId: string,
    expected: string,
    pairs: readonly { readonly id: string; readonly taskId: string }[],
  ): Promise<readonly Reminder[]> {
    if (pairs.length > 100) throw new RangeError('At most 100 reminders may be selected.');
    const generation = new DrizzleReminderGeneration(this.scope, this.tenant);
    await generation.verify(userId, expected);
    if (pairs.length === 0) return [];
    const rows = await this.scope.db
      .select()
      .from(reminders)
      .where(
        and(
          eq(reminders.organizationId, this.tenant),
          eq(reminders.userId, userId),
          isNull(reminders.completedAt),
          inArray(
            reminders.id,
            pairs.map((pair) => pair.id),
          ),
        ),
      );
    const byId = new Map(rows.map((row) => [row.id, row]));
    return pairs.flatMap((pair) => {
      const row = byId.get(pair.id.toLowerCase());
      return row?.taskId === pair.taskId.toLowerCase() ? [restore(row)] : [];
    });
  }
  // #endregion
}
