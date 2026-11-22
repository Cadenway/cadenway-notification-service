import type { TransactionScope } from '@cadenway/nest-common/database';
import type { FactoryProvider } from '@nestjs/common';

import { ReadActivityPreferences } from '../../../../application/use-cases/queries/preferences/read-activity-preferences/read-activity-preferences.use-case.js';
import {
  DrizzlePreferencesStore,
  lockPreferenceAccounts,
} from '../../../../infrastructure/persistence/drizzle/repositories/preferences/drizzle-preferences-store.repository.js';

/** Uses the narrow existing read-only recipient policy within a source fact's tenant transaction. */
async function withRecipientPreference<T>(
  scope: TransactionScope,
  userId: string,
  read: () => Promise<T>,
): Promise<T> {
  await scope.client.query("select set_config('app.notification_recipient_id', $1, true)", [
    userId,
  ]);
  let result: T;
  try {
    result = await read();
  } catch (error) {
    await scope.client
      .query("select set_config('app.notification_recipient_id', '', true)")
      .catch(() => undefined);
    throw error;
  }
  await scope.client.query("select set_config('app.notification_recipient_id', '', true)");
  return result;
}

/** Binds the existing transaction to account locks and narrow preference reads. */
export const readActivityPreferencesProvider: FactoryProvider<
  ReadActivityPreferences<TransactionScope>
> = {
  provide: ReadActivityPreferences,
  useFactory: () =>
    new ReadActivityPreferences<TransactionScope>(
      (scope, userId) => {
        const store = new DrizzlePreferencesStore(scope.db, userId);
        if (scope.kind === 'system' && scope.organizationId === null) return store;
        if (scope.kind !== 'tenant' || scope.organizationId === null) {
          throw new Error('Activity email preferences require an account or tenant transaction.');
        }
        return {
          lockAccount: (id) => store.lockAccount(id),
          find: (id) => withRecipientPreference(scope, userId, () => store.find(id)),
        };
      },
      async (scope, accountIds) => {
        if (scope.kind !== 'tenant' || scope.organizationId === null) {
          throw new Error('Activity email source preferences require a tenant transaction.');
        }
        await lockPreferenceAccounts(scope.db, accountIds);
      },
    ),
};
