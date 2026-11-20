import { NotificationPreferences } from '../../../../../domain/aggregates/preferences/notification-preferences.aggregate.js';
import type { PreferencesStore } from '../../../../ports/outbound/transactions/preferences/preferences-store.port.js';
import type { ReadActivityPreferencesOutput } from './read-activity-preferences.output.js';

/** Reads current preferences while holding the account lock in the caller's transaction. */
export class ReadActivityPreferences<TScope> {
  // #region Constructor
  /** Binds a reader to the supplied scope without starting another transaction. */
  public constructor(
    private readonly bind: (
      scope: TScope,
      userId: string,
    ) => Pick<PreferencesStore, 'lockAccount' | 'find'>,
  ) {}
  // #endregion

  // #region Methods
  /** Locks and reads exactly the selected account, using version-one defaults before any write. */
  public async execute(scope: TScope, userId: string): Promise<ReadActivityPreferencesOutput> {
    const accountId = userId.toLowerCase();
    const store = this.bind(scope, accountId);
    await store.lockAccount(accountId);
    const current = await store.find(accountId);
    return (current ?? NotificationPreferences.defaults(accountId)).snapshot;
  }
  // #endregion
}
