/** A current account preference snapshot, read under the account preference lock. */
export interface ActivityEmailPreferences {
  // #region Properties
  /** Values scoped to this operation. */
  readonly version: number;
  readonly cadence: 'each' | 'daily' | 'weekly' | 'never';
  readonly enabled: Readonly<
    Record<'assignment' | 'comment' | 'mention' | 'status-change' | 'approval' | 'access', boolean>
  >;
  // #endregion
}
