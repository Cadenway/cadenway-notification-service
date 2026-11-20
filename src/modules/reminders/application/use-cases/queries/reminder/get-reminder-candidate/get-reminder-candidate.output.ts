/** Owner-scoped immutable linkage for a Task access check. */
export interface GetReminderCandidateOutput {
  // #region Properties
  /** Reminder identifier. */
  readonly id: string;

  /** Linked task identifier. */
  readonly taskId: string;
  // #endregion
}
