import type { IsInAppNotificationEnabledInput } from './is-in-app-notification-enabled.input.js';

/** Resolves one current channel flag for a verified notification recipient. */
export class IsInAppNotificationEnabled {
  // #region Constructor
  /** Binds the account-scoped reader that joins the delivery transaction. */
  public constructor(
    private readonly read: (input: IsInAppNotificationEnabledInput) => Promise<boolean>,
  ) {}
  // #endregion

  // #region Methods
  /** Looks up the flag for one recipient and category. */
  public execute(input: IsInAppNotificationEnabledInput): Promise<boolean> {
    return this.read(input);
  }
  // #endregion
}
