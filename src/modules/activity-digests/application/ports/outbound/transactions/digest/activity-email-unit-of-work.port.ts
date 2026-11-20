import type { ActivityEmailStore } from './activity-email-store.port.js';

/** Opens a transaction with a tenant scope for staging, or an account scope for scheduling. */
export interface ActivityEmailUnitOfWork {
  // #region Methods
  /** Runs work within the requested ownership scope. */
  runTenant<T>(organizationId: string, work: (store: ActivityEmailStore) => Promise<T>): Promise<T>;
  runAccount<T>(userId: string, work: (store: ActivityEmailStore) => Promise<T>): Promise<T>;
  // #endregion
}
