import type { NotificationPreferences } from '../../../../../domain/aggregates/preferences/notification-preferences.aggregate.js';

/** One account-scoped transaction for reading and changing preferences. */
export interface PreferencesStore {
  // #region Methods
  /** Locks the account's preferences slot, including before first insertion. */
  lockAccount(userId: string): Promise<void>;

  /** Returns saved preferences or null before the first actual change. */
  find(userId: string): Promise<NotificationPreferences | null>;

  /** Persists the changed account aggregate in this transaction. */
  save(preferences: NotificationPreferences): Promise<void>;
  // #endregion
}
