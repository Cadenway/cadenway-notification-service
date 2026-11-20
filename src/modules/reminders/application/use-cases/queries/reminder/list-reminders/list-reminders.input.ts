/** Validated input to ListReminders. */
export interface ListRemindersInput {
  // #region Properties
  /** Fields supplied or returned by this operation. */
  readonly organizationId: string;
  readonly userId: string;
  readonly cursor: string | null;
  readonly limit: number;
  // #endregion
}
