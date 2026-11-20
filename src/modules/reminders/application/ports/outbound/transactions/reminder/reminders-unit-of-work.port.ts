import type { ReminderStore } from './reminder-store.port.js';

/** Runs all state changes, scheduled jobs and outbox writes in one tenant transaction. */
export interface RemindersUnitOfWork {
  // #region Methods
  /** Runs work scoped to the verified organization. */
  run<T>(organizationId: string, work: (store: ReminderStore) => Promise<T>): Promise<T>;
  // #endregion
}
