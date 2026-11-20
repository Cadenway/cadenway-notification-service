/** Cursor over exact subject groups in the owner's inbox generation. */
export interface InboxSubjectPosition {
  // #region Properties
  /** Stored selector kind, or an empty string for the owner-only group. */
  readonly kind: string;

  /** Stored selector value, or an empty string for the owner-only group. */
  readonly value: string;
  // #endregion
}
