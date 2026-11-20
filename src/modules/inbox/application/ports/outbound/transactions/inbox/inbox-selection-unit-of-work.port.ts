import type { InboxSelectionStore } from './inbox-selection-store.port.js';

/** Runs checked inbox writes in one tenant transaction. */
export interface InboxSelectionUnitOfWork {
  // #region Methods
  /** Opens the caller's tenant transaction and passes its scoped store. */
  run<T>(organizationId: string, work: (store: InboxSelectionStore) => Promise<T>): Promise<T>;
  // #endregion
}
