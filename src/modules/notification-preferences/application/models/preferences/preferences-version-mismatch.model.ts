/** An account's authorized current version for a failed conditional change. */
export class PreferencesVersionMismatch extends Error {
  // #region Constructor
  /** Preserves the current representation version. */
  public constructor(public readonly currentVersion: number) {
    super('Notification preferences version does not match.');
  }
  // #endregion
}
