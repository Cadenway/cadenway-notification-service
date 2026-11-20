import type { TenantTransactionRunner } from '@cadenway/nest-common/database';
import { z } from 'zod';

import { NotificationPreferences } from '../../../../../domain/aggregates/preferences/notification-preferences.aggregate.js';
import type { NotificationPreferencesSnapshot } from '../../../../../domain/value-objects/preferences/notification-preferences-snapshot.value-object.js';
import { DrizzlePreferencesStore } from './drizzle-preferences-store.repository.js';

type Category = keyof NotificationPreferencesSnapshot['channels'];

const accountIdSchema = z.uuid();

/** Reads one recipient's in-app choice inside the active tenant transaction. */
export class DrizzleInAppNotificationEnabled {
  // #region Constructor
  /** Binds the runner that joins the delivery's tenant transaction. */
  public constructor(private readonly runner: TenantTransactionRunner) {}
  // #endregion

  // #region Methods
  /** Serializes the read with account preference changes, including the default account. */
  public execute(userId: string, category: Category): Promise<boolean> {
    const accountId = accountIdSchema.parse(userId).toLowerCase();
    return this.runner.run(async (scope) => {
      if (scope.organizationId === null)
        throw new Error('Notification preference read needs a tenant.');
      const store = new DrizzlePreferencesStore(scope.db, accountId);
      await store.lockAccount(accountId);
      await scope.client.query("select set_config('app.notification_recipient_id', $1, true)", [
        accountId,
      ]);
      let enabled: boolean;
      try {
        const result = await scope.client.query(
          "select channels -> $2 -> 'inApp' as enabled from notification_preferences where user_id = $1::uuid",
          [accountId, category],
        );
        const row: unknown = result.rows[0];
        if (row === undefined) {
          enabled = NotificationPreferences.defaults(accountId).snapshot.channels[category].inApp;
        } else {
          const parsed = z.object({ enabled: z.boolean() }).safeParse(row);
          if (!parsed.success) throw new Error('Invalid in-app notification preference.');
          enabled = parsed.data.enabled;
        }
      } catch (error) {
        await scope.client
          .query("select set_config('app.notification_recipient_id', '', true)")
          .catch(() => undefined);
        throw error;
      }
      await scope.client.query("select set_config('app.notification_recipient_id', '', true)");
      return enabled;
    });
  }
  // #endregion
}
