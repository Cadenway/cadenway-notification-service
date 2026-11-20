/** Validated input to CompleteReminder. */
export interface CompleteReminderInput {
  // #region Properties
  /** Fields supplied or returned by this operation. */
  readonly organizationId: string;
  readonly userId: string;
  readonly id: string;
  readonly authorizedTaskId: string;
  readonly expectedVersions?: readonly number[] | '*';
  readonly now: number;
  // #endregion
}
