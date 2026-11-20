/** Base class for the rules enforced by the notification preferences domain. */
abstract class DomainError extends Error {}

/** A preference state with invalid channel flags, cadence, account or version. */
export class NotificationPreferencesError extends DomainError {
  // #region Constructor
  /** Describes the invalid record without quoting account data. */
  public constructor() {
    super('Invalid notification preferences.');
    this.name = 'NotificationPreferencesError';
  }
  // #endregion
}
