import type { ReminderAuthorizationStore } from './reminder-authorization-store.port.js';

/** Opens one tenant transaction for the reminder and its authorization attempt. */
export interface ReminderAuthorizationUnitOfWork {
  // #region Methods
  /** Executes an operation under its verified tenant. */
  run<T>(
    organizationId: string,
    execute: (store: ReminderAuthorizationStore) => Promise<T>,
  ): Promise<T>;
  // #endregion
}
