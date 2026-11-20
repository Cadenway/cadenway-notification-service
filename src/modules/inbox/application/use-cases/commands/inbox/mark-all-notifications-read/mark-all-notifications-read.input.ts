/** Validated input to MarkAllNotificationsRead. */
export interface MarkAllNotificationsReadInput {
  // #region Properties
  /** Fields supplied or returned by this operation. */
  readonly organizationId: string;
  readonly userId: string;
  readonly now: number;
  // #endregion
}
