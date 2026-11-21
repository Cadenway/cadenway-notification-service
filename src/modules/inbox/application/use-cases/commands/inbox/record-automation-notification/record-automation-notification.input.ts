/** A delegated automation command validated and authorized for its current request. */
export interface RecordAutomationNotificationInput {
  // #region Properties
  /** Tenant from the verified internal token. */
  readonly organizationId: string;

  /** Task key from the original event. */
  readonly taskKey: string;

  /** Current rule author identified by the command. */
  readonly ruleAuthorUserId: string;

  /** Recipient identified by the command. */
  readonly recipientUserId: string;

  /** Canonical rule ID from the verified automation actor. */
  readonly ruleId: string;

  /** Stable key for this occurrence of the rule action. */
  readonly commandKey: string;
  // #endregion
}
