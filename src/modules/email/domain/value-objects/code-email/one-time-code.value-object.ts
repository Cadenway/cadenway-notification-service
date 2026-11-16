import { InvalidOneTimeCodeError } from '../../errors/code-email/invalid-one-time-code.error.js';

/**
 * Constant CODE_PATTERN
 *
 * @description
 * Six digits, the pattern of `code` in `one-time-code.issued.v1` (asyncapi/identity-service.yaml
 * of cadenway-api-contracts).
 *
 * @type {RegExp}
 */
const CODE_PATTERN: RegExp = /^[0-9]{6}$/u;

/**
 * Constant MASK
 *
 * @description
 * What a code turns into when it is converted to a string or serialized, so that a log line or an
 * error that carries the object by mistake never carries the digits.
 *
 * @type {string}
 */
const MASK: string = '[one-time code]';

/**
 * Class OneTimeCode
 *
 * @description
 * The single-use code of an e-mail, a secret valid a few minutes. It is never logged nor kept in
 * the send log: `toString` and `toJSON` mask it, and its digits leave the object only through
 * `reveal` (to store it until the e-mail is sent) and `display` (to show it in the e-mail).
 */
export class OneTimeCode {
  // #region Properties
  /**
   * Property digits
   *
   * @description
   * The 6 digits. Private, so that spreading or inspecting the object does not reach them.
   *
   * @type {string}
   * @readonly
   */
  readonly #digits: string;
  // #endregion

  // #region Constructor
  /**
   * Constructor
   *
   * @description
   * Keeps digits already checked by `of`.
   *
   * @param {string} digits - The 6 digits.
   * @constructor
   */
  private constructor(digits: string) {
    this.#digits = digits;
  }
  // #endregion

  // #region Methods
  /**
   * Method of
   *
   * @description
   * Builds a code from its digits.
   *
   * @param {string} digits - The 6 digits of the event.
   * @returns {OneTimeCode} The code.
   * @throws {InvalidOneTimeCodeError} When the value is not exactly 6 digits.
   */
  public static of(digits: string): OneTimeCode {
    if (!CODE_PATTERN.test(digits)) {
      throw new InvalidOneTimeCodeError();
    }
    return new OneTimeCode(digits);
  }

  /**
   * Method display
   *
   * @description
   * The code as the e-mail shows it, in two groups of three digits: `482 913` (the "Code de
   * connexion" e-mail of the mockup, and the description of `code` in the contract).
   *
   * @returns {string} The grouped digits.
   */
  public display(): string {
    return `${this.#digits.slice(0, 3)} ${this.#digits.slice(3)}`;
  }

  /**
   * Method reveal
   *
   * @description
   * The digits as they were issued, to keep them until the e-mail is sent. Never pass the result
   * to a logger.
   *
   * @returns {string} The 6 digits.
   */
  public reveal(): string {
    return this.#digits;
  }

  /**
   * Method toString
   *
   * @description
   * A masked placeholder: a template string or a concatenation never prints the digits.
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
   * A masked placeholder: `JSON.stringify` and the JSON logger never print the digits.
   *
   * @returns {string} The mask.
   */
  public toJSON(): string {
    return MASK;
  }
  // #endregion
}
