import { InvalidInvitationExpiryError } from '../../errors/invitation-email/invalid-invitation-expiry.error.js';

/**
 * Constant MAX_VALIDITY_MS
 *
 * @description
 * Longest validity accepted, in milliseconds: the 7 days `invitation.issued.v1` gives an
 * invitation from its sending, plus a day of tolerance for the clocks. It bounds how long the
 * invited address waits in this service.
 *
 * @type {number}
 */
const MAX_VALIDITY_MS: number = 8 * 86_400_000;

/**
 * Class InvitationValidity
 *
 * @description
 * When an invitation was sent, or sent again, and when it stops working (`occurredAt` and
 * `expiresAt` of `invitation.issued.v1`, 7 days apart; organization-service answers
 * `invitation.expired` from then on). The e-mail says the expiry day, and an invitation whose
 * expiry has passed is never sent.
 */
export class InvitationValidity {
  // #region Properties
  /**
   * Property issuedAt
   *
   * @description
   * When the invitation was sent or sent again.
   *
   * @type {Date}
   * @readonly
   */
  public readonly issuedAt: Date;

  /**
   * Property expiresAt
   *
   * @description
   * When the invitation stops working, strictly after `issuedAt` and at most 8 days later.
   *
   * @type {Date}
   * @readonly
   */
  public readonly expiresAt: Date;
  // #endregion

  // #region Constructor
  /**
   * Constructor
   *
   * @description
   * Keeps two instants already checked by `between`.
   *
   * @param {Date} issuedAt - When the invitation was sent.
   * @param {Date} expiresAt - When it stops working.
   * @constructor
   */
  private constructor(issuedAt: Date, expiresAt: Date) {
    this.issuedAt = issuedAt;
    this.expiresAt = expiresAt;
  }
  // #endregion

  // #region Methods
  /**
   * Method between
   *
   * @description
   * Builds the validity of an invitation. The instants are copied, so the caller cannot change
   * them afterwards.
   *
   * @param {Date} issuedAt - When the invitation was sent or sent again.
   * @param {Date} expiresAt - When it stops working.
   * @returns {InvitationValidity} The validity.
   * @throws {InvalidInvitationExpiryError} When an instant is invalid, or the invitation does not
   * expire after it was sent and within 8 days.
   */
  public static between(issuedAt: Date, expiresAt: Date): InvitationValidity {
    const issued: number = issuedAt.getTime();
    const expires: number = expiresAt.getTime();
    if (
      Number.isNaN(issued) ||
      Number.isNaN(expires) ||
      expires <= issued ||
      expires - issued > MAX_VALIDITY_MS
    ) {
      throw new InvalidInvitationExpiryError();
    }
    return new InvitationValidity(new Date(issued), new Date(expires));
  }

  /**
   * Method isExpiredAt
   *
   * @description
   * Whether the invitation no longer works at an instant: from `expiresAt` on.
   *
   * @param {Date} now - The instant to check.
   * @returns {boolean} `true` from the expiry on.
   */
  public isExpiredAt(now: Date): boolean {
    return now.getTime() >= this.expiresAt.getTime();
  }
  // #endregion
}
