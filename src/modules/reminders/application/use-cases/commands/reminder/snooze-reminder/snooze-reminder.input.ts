/** Validated input to SnoozeReminder. */
export interface SnoozeReminderInput {
  // #region Properties
  /** Fields supplied or returned by this operation. */
  readonly organizationId: string;
  readonly userId: string;
  readonly id: string;
  readonly authorizedTaskId: string;
  readonly expectedVersions?: readonly number[] | '*';
  readonly remindAt: number;
  readonly now: number;
  // #endregion
}
