/** Verified, active Identity profile, associated with the requested account by the reader. */
export interface ActivityEmailRecipient {
  // #region Properties
  /** Values scoped to this operation. */
  readonly userId: string;
  readonly email: string;
  readonly language: string;
  readonly timeZone: string | null;
  readonly version: number;
  // #endregion
}
