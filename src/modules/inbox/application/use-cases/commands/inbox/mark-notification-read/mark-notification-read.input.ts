/** Validated input to MarkNotificationRead. */
export interface MarkNotificationReadInput {
  // #region Properties
  /** Fields supplied or returned by this operation. */
  readonly organizationId: string;
  readonly userId: string;
  readonly id: string;
  readonly now: number;
  readonly expectedVersion?: number;
  // #endregion
}
