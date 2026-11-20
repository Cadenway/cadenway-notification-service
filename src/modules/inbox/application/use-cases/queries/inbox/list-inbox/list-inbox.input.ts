/** Validated input to ListInbox. */
export interface ListInboxInput {
  // #region Properties
  /** Fields supplied or returned by this operation. */
  readonly organizationId: string;
  readonly userId: string;
  readonly state: 'all' | 'unread' | 'archived';
  readonly cursor: string | null;
  readonly limit: number;
  // #endregion
}
