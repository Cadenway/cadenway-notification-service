import type { TransactionDatabase } from '@cadenway/nest-common/database';
import { eq, sql } from 'drizzle-orm';

import type { PreferencesStore } from '../../../../../application/ports/outbound/transactions/preferences/preferences-store.port.js';
import { NotificationPreferences } from '../../../../../domain/aggregates/preferences/notification-preferences.aggregate.js';
import { notificationPreferences } from '../../schemas/preferences/notification-preferences.schema.js';

/** Persists the preferences of one verified account within a system transaction. */
export class DrizzlePreferencesStore implements PreferencesStore {
  // #region Properties
  /** Canonical key of the account selected by the unit of work. */
  private readonly accountId: string;
  // #endregion

  // #region Constructor
  /** Binds the account and database to the runner's active transaction. */
  public constructor(
    private readonly db: TransactionDatabase,
    userId: string,
  ) {
    this.accountId = userId.toLowerCase();
  }
  // #endregion

  // #region Methods
  /** Serializes updates to the account's slot, including before a preferences row exists. */
  public async lockAccount(userId: string): Promise<void> {
    this.requireAccount(userId);
    await this.db.execute(
      sql`select pg_advisory_xact_lock(hashtextextended('notification_preferences:' || ${this.accountId}::uuid::text, 0))`,
    );
  }

  /** Loads the saved state for the bound account. The use case supplies defaults on absence. */
  public async find(userId: string): Promise<NotificationPreferences | null> {
    this.requireAccount(userId);
    const [row] = await this.db
      .select({
        userId: notificationPreferences.userId,
        channels: notificationPreferences.channels,
        digest: notificationPreferences.digest,
        doNotDisturb: notificationPreferences.doNotDisturb,
        version: notificationPreferences.version,
      })
      .from(notificationPreferences)
      .where(eq(notificationPreferences.userId, this.accountId));
    return row === undefined ? null : NotificationPreferences.restore(row);
  }

  /** Writes a changed aggregate after the use case has locked the account's slot. */
  public async save(preferences: NotificationPreferences): Promise<void> {
    const { userId, ...settings } = preferences.snapshot;
    this.requireAccount(userId);
    await this.db
      .insert(notificationPreferences)
      .values({ userId: this.accountId, ...settings })
      .onConflictDoUpdate({
        target: notificationPreferences.userId,
        set: { ...settings, updatedAt: sql`statement_timestamp()` },
      });
  }

  /** Guards the explicit account boundary of the store while system row access is enabled. */
  private requireAccount(userId: string): void {
    if (userId.toLowerCase() !== this.accountId) {
      throw new Error('Preference store access requires its bound account.');
    }
  }
  // #endregion
}
