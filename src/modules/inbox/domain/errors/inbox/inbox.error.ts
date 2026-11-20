/** Base class for the rules enforced by the inbox domain. */
abstract class DomainError extends Error {}

/** A concealed inbox item or invalid inbox state, without recipient or content details. */
export class InboxError extends DomainError {
  // #region Properties
  /** The rule that produced the error. */
  public readonly code: 'notification.not-found' | 'invalid-notification';
  // #endregion

  // #region Constructor
  /** Builds a refusal without including account or notification data. */
  public constructor(code: 'notification.not-found' | 'invalid-notification') {
    super(code === 'notification.not-found' ? 'Notification not found.' : 'Invalid notification.');
    this.name = 'InboxError';
    this.code = code;
  }
  // #endregion
}
