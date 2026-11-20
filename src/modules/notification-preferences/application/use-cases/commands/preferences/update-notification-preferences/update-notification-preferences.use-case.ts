import { NotificationPreferences } from '../../../../../domain/aggregates/preferences/notification-preferences.aggregate.js';
import type { PreferencesUnitOfWork } from '../../../../ports/outbound/transactions/preferences/preferences-unit-of-work.port.js';
import { PreferencesVersionMismatch } from '../../../../models/preferences/preferences-version-mismatch.model.js';
import type { UpdateNotificationPreferencesInput } from './update-notification-preferences.input.js';
import type { UpdateNotificationPreferencesOutput } from './update-notification-preferences.output.js';

/** UpdateNotificationPreferences runs against the verified caller scope. */
export class UpdateNotificationPreferences {
  // #region Constructor
  /** Binds the operation’s persistence port. */
  public constructor(private readonly work: PreferencesUnitOfWork) {}
  // #endregion

  // #region Methods
  /** Executes the operation. */
  public async execute(
    input: UpdateNotificationPreferencesInput,
  ): Promise<UpdateNotificationPreferencesOutput> {
    return this.work.run(input.userId, async (store) => {
      await store.lockAccount(input.userId);
      const saved = await store.find(input.userId);
      const current = saved ?? NotificationPreferences.defaults(input.userId);
      if (
        input.expectedVersions !== undefined &&
        input.expectedVersions !== '*' &&
        !input.expectedVersions.includes(current.snapshot.version)
      ) {
        throw new PreferencesVersionMismatch(current.snapshot.version);
      }
      const changed = current.patch(input.patch);
      if (changed !== current) await store.save(changed);
      return changed.snapshot;
    });
  }
  // #endregion
}
