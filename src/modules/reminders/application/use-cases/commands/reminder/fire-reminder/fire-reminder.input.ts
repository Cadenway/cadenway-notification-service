/** Validated input to FireReminder. */
export interface FireReminderInput {
  // #region Properties
  /** Fields supplied or returned by this operation. */
  readonly organizationId: string;
  readonly userId: string;
  readonly id: string;
  readonly scheduleVersion: number;
  readonly now: number;
  // #endregion
}
