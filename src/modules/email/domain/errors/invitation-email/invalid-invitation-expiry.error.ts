import { DomainError } from '../code-email/domain.error.js';

/**
 * Class InvalidInvitationExpiryError
 *
 * @description
 * An invitation stops working after it was sent, 7 days later (`occurredAt` and `expiresAt` of
 * `invitation.issued.v1`): both are valid instants, the expiry comes after the sending and within
 * 8 days of it, a day of tolerance included.
 */
export class InvalidInvitationExpiryError extends DomainError {
  // #region Constructor
  /**
   * Constructor
   *
   * @description
   * States the rule.
   *
   * @constructor
   */
  public constructor() {
    super('An invitation expires after it was sent, within 8 days.');
  }
  // #endregion
}
