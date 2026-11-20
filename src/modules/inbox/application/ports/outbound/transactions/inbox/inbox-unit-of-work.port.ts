import type { InboxStore } from './inbox-store.port.js';

/** Owns the inbox transaction and the current authorization snapshot. */
export interface InboxUnitOfWork {
  // #region Methods
  /** Runs work within the verified tenant scope. */
  run<T>(organizationId: string, work: (store: InboxStore) => Promise<T>): Promise<T>;
  // #endregion
}
