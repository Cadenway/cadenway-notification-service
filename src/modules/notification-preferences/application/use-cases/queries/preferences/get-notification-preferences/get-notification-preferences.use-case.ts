import { NotificationPreferences } from '../../../../../domain/aggregates/preferences/notification-preferences.aggregate.js';
import type { PreferencesUnitOfWork } from '../../../../ports/outbound/transactions/preferences/preferences-unit-of-work.port.js';
import type { GetNotificationPreferencesInput } from './get-notification-preferences.input.js';
import type { GetNotificationPreferencesOutput } from './get-notification-preferences.output.js';

/** GetNotificationPreferences runs against the verified caller scope. */
export class GetNotificationPreferences {
  // #region Constructor
  /** Binds the operation’s persistence port. */
  public constructor(private readonly work: PreferencesUnitOfWork) {}
  // #endregion

  // #region Methods
  /** Executes the operation. */
  public async execute(
    input: GetNotificationPreferencesInput,
  ): Promise<GetNotificationPreferencesOutput> {
    return this.work.run(
      input.userId,
      async (store) =>
        ((await store.find(input.userId)) ?? NotificationPreferences.defaults(input.userId))
          .snapshot,
    );
  }
  // #endregion
}
