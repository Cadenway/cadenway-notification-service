/** Validated input to GetReminder. */
export interface GetReminderInput {
  // #region Properties
  /** Fields supplied or returned by this operation. */
  readonly organizationId: string;
  readonly userId: string;
  readonly id: string;
  readonly authorizedTaskId: string;
  // #endregion
}
