/** Resolves live Task authority for one automation notification command. */
export interface AutomationNotificationAuthority {
  // #region Methods
  /** Checks the task, rule author and recipient together for the verified organization. */
  authorize(input: {
    readonly organizationId: string;
    readonly taskKey: string;
    readonly ruleAuthorUserId: string;
    readonly recipientUserId: string;
  }): Promise<'allowed' | 'denied' | 'unavailable'>;
  // #endregion
}
