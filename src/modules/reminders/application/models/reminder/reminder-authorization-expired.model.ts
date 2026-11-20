/** Aborts a reminder transaction when its authorization expires during writes. */
export class ReminderAuthorizationExpired extends Error {
  // #region Constructor
  /** Keeps the rollback reason free of reminder and recipient data. */
  public constructor() {
    super('Reminder authorization expired during processing.');
  }
  // #endregion
}
