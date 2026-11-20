import type { SystemTransactionRunner } from '@cadenway/nest-common/database';

import type { PreferencesStore } from '../../../../../application/ports/outbound/transactions/preferences/preferences-store.port.js';
import type { PreferencesUnitOfWork } from '../../../../../application/ports/outbound/transactions/preferences/preferences-unit-of-work.port.js';
import { DrizzlePreferencesStore } from '../../repositories/preferences/drizzle-preferences-store.repository.js';

/** Opens the global preferences transaction and restricts the store to one verified account. */
export class SystemPreferencesUnitOfWork implements PreferencesUnitOfWork {
  // #region Constructor
  /** Binds the kit runner for data that belongs to no organization. */
  public constructor(private readonly system: SystemTransactionRunner) {}
  // #endregion

  // #region Methods
  /** Uses read committed so the read after the account lock sees the previous writer's commit. */
  public run<T>(userId: string, work: (store: PreferencesStore) => Promise<T>): Promise<T> {
    return this.system.run(({ db }) => work(new DrizzlePreferencesStore(db, userId)), {
      isolationLevel: 'read committed',
    });
  }
  // #endregion
}
