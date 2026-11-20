/** Validated input to GetTaskReminder. */
export interface GetTaskReminderInput {
  // #region Properties
  /** Fields supplied or returned by this operation. */
  readonly organizationId: string;
  readonly userId: string;
  readonly taskId: string;
  // #endregion
}
