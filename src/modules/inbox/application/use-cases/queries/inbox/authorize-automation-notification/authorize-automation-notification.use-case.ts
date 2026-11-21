import type { AutomationNotificationAuthority } from '../../../../ports/outbound/tasks/inbox/automation-notification-authority.port.js';

/** Resolves the live authorization snapshot for the current automation command. */
export class AuthorizeAutomationNotification {
  // #region Constructor
  /** Binds the owning Task authority. */
  public constructor(private readonly authority: AutomationNotificationAuthority) {}
  // #endregion

  // #region Methods
  /** Checks the triggering task, author and recipient without opening a transaction. */
  public execute(
    input: Parameters<AutomationNotificationAuthority['authorize']>[0],
  ): Promise<'allowed' | 'denied' | 'unavailable'> {
    return this.authority.authorize(input);
  }
  // #endregion
}
