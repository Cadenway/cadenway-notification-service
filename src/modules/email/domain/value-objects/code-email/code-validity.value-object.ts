import { InvalidCodeValidityError } from '../../errors/code-email/invalid-code-validity.error.js';

/**
 * Constant MINUTE_MS
 *
 * @description
 * One minute, in milliseconds.
 *
 * @type {number}
 */
const MINUTE_MS: number = 60_000;

/**
 * Class CodeValidity
 *
 * @description
 * When a code was issued and when it stops working (`occurredAt` and `expiresAt` of
 * `one-time-code.issued.v1`). The contract gives a sign-up or sign-in code 10 minutes; the e-mail
 * says how long the code is valid, from these two instants, and a code whose expiry has passed is
 * never sent.
 */
export class CodeValidity {
  // #region Properties
  /**
   * Property issuedAt
   *
   * @description
   * When the code was issued.
   *
   * @type {Date}
   * @readonly
   */
  public readonly issuedAt: Date;

  /**
   * Property expiresAt
   *
   * @description
   * When the code stops working, strictly after `issuedAt`.
   *
   * @type {Date}
   * @readonly
   */
  public readonly expiresAt: Date;

  /**
   * Property minutes
   *
   * @description
   * How long the code is valid from its issue, in whole minutes and at least 1: the "10" of
   * "Valable 10 minutes, une seule fois". Rounded, so a few milliseconds between the two instants
   * of the event do not turn 10 minutes into 9.
   *
   * @type {number}
   */
  public get minutes(): number {
    return Math.max(
      1,
      Math.round((this.expiresAt.getTime() - this.issuedAt.getTime()) / MINUTE_MS),
    );
  }
  // #endregion

  // #region Constructor
  /**
   * Constructor
   *
   * @description
   * Keeps two instants already checked by `between`.
   *
   * @param {Date} issuedAt - When the code was issued.
   * @param {Date} expiresAt - When the code stops working.
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
   * Builds the validity of a code. The instants are copied, so the caller cannot change them
   * afterwards.
   *
   * @param {Date} issuedAt - When the code was issued.
   * @param {Date} expiresAt - When the code stops working.
   * @returns {CodeValidity} The validity.
   * @throws {InvalidCodeValidityError} When an instant is invalid or the code expires before it
   * was issued.
   */
  public static between(issuedAt: Date, expiresAt: Date): CodeValidity {
    const issued: number = issuedAt.getTime();
    const expires: number = expiresAt.getTime();
    if (Number.isNaN(issued) || Number.isNaN(expires) || expires <= issued) {
      throw new InvalidCodeValidityError();
    }
    return new CodeValidity(new Date(issued), new Date(expires));
  }

  /**
   * Method isExpiredAt
   *
   * @description
   * Whether the code no longer works at an instant: from `expiresAt` on, as identity-service
   * refuses it (`auth.code-expired` of the public auth contract).
   *
   * @param {Date} now - The instant to check.
   * @returns {boolean} `true` from the expiry on.
   */
  public isExpiredAt(now: Date): boolean {
    return now.getTime() >= this.expiresAt.getTime();
  }
  // #endregion
}
