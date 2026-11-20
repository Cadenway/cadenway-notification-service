import type { TransactionScope } from '@cadenway/nest-common/database';
import { and, eq, sql } from 'drizzle-orm';

import { ReminderGenerationChanged } from '../../../../../domain/errors/reminder/reminder-generation-changed.error.js';
import { reminderGenerations } from '../../schemas/reminder/reminder-generations.schema.js';

/** Serializes each owner's reminder writers, including before its first record. */
export class DrizzleReminderGeneration {
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
  /** Takes the owner lock before any slot, reminder or authorization-attempt lock. */
  public async lock(userId: string): Promise<void> {
    const key = `reminder-generation:${this.tenant}:${userId.toLowerCase()}`;
    await this.scope.db.execute(sql`select pg_advisory_xact_lock(hashtextextended(${key}, 0))`);
  }

  /** Reads the owner's generation; a new owner starts at zero. */
  public async current(userId: string): Promise<bigint> {
    const rows = await this.scope.db
      .select({ generation: reminderGenerations.generation })
      .from(reminderGenerations)
      .where(
        and(
          eq(reminderGenerations.organizationId, this.tenant),
          eq(reminderGenerations.userId, userId),
        ),
      )
      .limit(1);
    return rows[0]?.generation ?? 0n;
  }

  /** Verifies a decimal generation within the caller's repeatable-read snapshot. */
  public async verify(userId: string, expected: string | null): Promise<bigint> {
    const current = await this.current(userId);
    if (expected !== null) {
      if (!/^(0|[1-9][0-9]{0,18})$/u.test(expected) || BigInt(expected) > 9223372036854775807n)
        throw new RangeError('Invalid reminder generation.');
      if (BigInt(expected) !== current) throw new ReminderGenerationChanged();
    }
    return current;
  }

  /** Advances the locked owner's generation in the same transaction as its mutation. */
  public async advance(userId: string): Promise<void> {
    await this.scope.db
      .insert(reminderGenerations)
      .values({ organizationId: this.tenant, userId, generation: 1n })
      .onConflictDoUpdate({
        target: [reminderGenerations.organizationId, reminderGenerations.userId],
        set: { generation: sql`${reminderGenerations.generation} + 1` },
      });
  }
  // #endregion
}
