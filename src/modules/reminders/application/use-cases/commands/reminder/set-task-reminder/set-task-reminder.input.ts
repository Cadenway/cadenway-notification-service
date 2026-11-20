/** Validated input to SetTaskReminder. */
export interface SetTaskReminderInput {
  // #region Properties
  /** Fields supplied or returned by this operation. */
  readonly organizationId: string;
  readonly userId: string;
  readonly taskId: string;
  readonly remindAt: number;
  readonly note: string | null;
  readonly now: number;
  readonly expectedVersions?: readonly number[] | '*';
  // #endregion
}
