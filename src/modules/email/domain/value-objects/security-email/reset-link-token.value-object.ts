import { InvalidResetLinkTokenError } from '../../errors/security-email/invalid-reset-link-token.error.js';

/**
 * Constant TOKEN_PATTERN
 *
 * @description
 * The pattern of `token` in `password-reset-link.issued.v1` (asyncapi/identity-service.yaml of
 * `@cadenway/contracts`): base64url without padding, 32 to 128 characters.
 *
 * @type {RegExp}
 */
const TOKEN_PATTERN: RegExp = /^[A-Za-z0-9_-]{32,128}$/u;

/**
 * Constant MASK
 *
 * @description
 * What a token turns into when it is converted to a string or serialized, so that a log line or an
 * error that carries the object by mistake never carries the secret.
 *
 * @type {string}
 */
const MASK: string = '[reset link token]';

/**
 * Class ResetLinkToken
 *
 * @description
 * The secret of a password reset link, valid 30 minutes and once (decision 2 of the account
 * security brief). Anyone who reads it can choose the password of the account: it is never logged
 * nor kept in the send log. `toString` and `toJSON` mask it, and it leaves the object only through
 * `reveal`, to store it until the e-mail is sent and to put it in the link of the e-mail.
 */
export class ResetLinkToken {
  // #region Properties
  /**
   * Property value
   *
   * @description
   * The secret. Private, so that spreading or inspecting the object does not reach it.
   *
   * @type {string}
   * @readonly
   */
  readonly #value: string;
  // #endregion

  // #region Constructor
  /**
   * Constructor
   *
   * @description
   * Keeps a secret already checked by `of`.
   *
   * @param {string} value - The secret.
   * @constructor
   */
  private constructor(value: string) {
    this.#value = value;
  }
  // #endregion

  // #region Methods
  /**
   * Method of
   *
   * @description
   * Builds a token from the secret of the event.
   *
   * @param {string} value - The secret of the link.
   * @returns {ResetLinkToken} The token.
   * @throws {InvalidResetLinkTokenError} When the value is not 32 to 128 URL-safe characters.
   */
  public static of(value: string): ResetLinkToken {
    if (!TOKEN_PATTERN.test(value)) {
      throw new InvalidResetLinkTokenError();
    }
    return new ResetLinkToken(value);
  }

  /**
   * Method reveal
   *
   * @description
   * The secret as it was issued, to keep it until the e-mail is sent and to build the link. Never
   * pass the result to a logger.
   *
   * @returns {string} The secret.
   */
  public reveal(): string {
    return this.#value;
  }

  /**
   * Method toString
   *
   * @description
   * A masked placeholder: a template string or a concatenation never prints the secret.
   *
   * @returns {string} The mask.
   */
  public toString(): string {
    return MASK;
  }

  /**
   * Method toJSON
   *
   * @description
   * A masked placeholder: `JSON.stringify` and the JSON logger never print the secret.
   *
   * @returns {string} The mask.
   */
  public toJSON(): string {
    return MASK;
  }
  // #endregion
}
