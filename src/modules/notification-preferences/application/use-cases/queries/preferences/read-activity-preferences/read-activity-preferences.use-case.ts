import { NotificationPreferences } from '../../../../../domain/aggregates/preferences/notification-preferences.aggregate.js';
import type { PreferencesStore } from '../../../../ports/outbound/transactions/preferences/preferences-store.port.js';
import type { ReadActivityPreferencesOutput } from './read-activity-preferences.output.js';

const recipientLockBatchSize = 250;

/** Reads current preferences while holding the account lock in the caller's transaction. */
export class ReadActivityPreferences<TScope> {
  // #region Constructor
  /** Binds a reader to the supplied scope without starting another transaction. */
  public constructor(
    private readonly bind: (
      scope: TScope,
      userId: string,
    ) => Pick<PreferencesStore, 'lockAccount' | 'find'>,
    private readonly lockRecipients: (
      scope: TScope,
      accountIds: readonly string[],
    ) => Promise<void>,
  ) {}
  // #endregion

  // #region Methods
  /** Locks and reads exactly the selected account, using version-one defaults before any write. */
  public async execute(scope: TScope, userId: string): Promise<ReadActivityPreferencesOutput> {
    const accountId = userId.toLowerCase();
    const store = this.bind(scope, accountId);
    await store.lockAccount(accountId);
    return this.readLocked(store, accountId);
  }

  /** Locks distinct source recipients in UUID order and reads each in its own recipient scope. */
  public async executeForRecipients(
    scope: TScope,
    userIds: readonly string[],
  ): Promise<ReadonlyMap<string, ReadActivityPreferencesOutput>> {
    const orderedAccountIds = [...new Set(userIds.map((userId) => userId.toLowerCase()))].sort();
    const preferences = new Map<string, ReadActivityPreferencesOutput>();
    for (let index = 0; index < orderedAccountIds.length; index += recipientLockBatchSize) {
      const batch = orderedAccountIds.slice(index, index + recipientLockBatchSize);
      await this.lockRecipients(scope, batch);
      for (const accountId of batch) {
        preferences.set(accountId, await this.readLocked(this.bind(scope, accountId), accountId));
      }
    }
    return preferences;
  }

  /** Applies the domain defaults when the locked recipient has no saved preferences. */
  private async readLocked(
    store: Pick<PreferencesStore, 'find'>,
    accountId: string,
  ): Promise<ReadActivityPreferencesOutput> {
    const current = await store.find(accountId);
    return (current ?? NotificationPreferences.defaults(accountId)).snapshot;
  }
  // #endregion
}
