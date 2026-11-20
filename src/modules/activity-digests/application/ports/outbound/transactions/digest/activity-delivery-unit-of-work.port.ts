import type { ActivityDeliveryStore } from './activity-delivery-store.port.js';

/** Opens the account-owned occurrence transaction; adapters must scope every candidate by tenant. */
export interface ActivityDeliveryUnitOfWork {
  // #region Methods
  /** Runs work within the requested ownership scope. */
  runAccount<T>(userId: string, work: (store: ActivityDeliveryStore) => Promise<T>): Promise<T>;
  runTenant<T>(
    organizationId: string,
    work: (store: ActivityDeliveryStore) => Promise<T>,
  ): Promise<T>;
  // #endregion
}
