/** Validated input to ArchiveNotification. */
export interface ArchiveNotificationInput {
  // #region Properties
  /** Fields supplied or returned by this operation. */
  readonly organizationId: string;
  readonly userId: string;
  readonly id: string;
  readonly now: number;
  readonly expectedVersion?: number;
  // #endregion
}
