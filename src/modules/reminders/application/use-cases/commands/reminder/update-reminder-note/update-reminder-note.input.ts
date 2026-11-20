/** Validated input to UpdateReminderNote. */
export interface UpdateReminderNoteInput {
  // #region Properties
  /** Fields supplied or returned by this operation. */
  readonly organizationId: string;
  readonly userId: string;
  readonly id: string;
  readonly authorizedTaskId: string;
  readonly expectedVersions?: readonly number[] | '*';
  readonly note: string | null;
  // #endregion
}
