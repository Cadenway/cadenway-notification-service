import type { InboxDeliveryStore } from './inbox-delivery-store.port.js';

/** Joins the tenant transaction used for event deduplication or opens a new one. */
export interface InboxDeliveryUnitOfWork {
  // #region Methods
  /** Runs inbox authorization and outbox writes in the verified organization. */
  run<T>(organizationId: string, execute: (store: InboxDeliveryStore) => Promise<T>): Promise<T>;
  // #endregion
}
