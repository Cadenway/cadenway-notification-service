import type { PreferencesStore } from './preferences-store.port.js';

/** Owns the account-scoped preferences transaction. */
export interface PreferencesUnitOfWork {
  // #region Methods
  /** Runs work for the verified account. */
  run<T>(userId: string, work: (store: PreferencesStore) => Promise<T>): Promise<T>;
  // #endregion
}
