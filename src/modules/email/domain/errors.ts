/**
 * Class DomainError
 *
 * @description
 * Base class of the errors the email domain raises when asked to build an invalid state. Its
 * message names the rule and never quotes the value that broke it, which may be a code or an
 * address.
 */
export abstract class DomainError extends Error {
  // #region Constructor
  /**
   * Constructor
   *
   * @description
   * Names the error after its concrete class, so logs and stored job errors carry the rule.
   *
   * @param {string} message - Rule that was broken, without the offending value.
   * @constructor
   */
  public constructor(message: string) {
    super(message);
    this.name = new.target.name;
  }
  // #endregion
}

/**
 * Class InvalidOneTimeCodeError
 *
 * @description
 * A single-use code is exactly 6 digits (`code` of `one-time-code.issued.v1`, pattern
 * `^[0-9]{6}$`).
 */
export class InvalidOneTimeCodeError extends DomainError {
  // #region Constructor
  /**
   * Constructor
   *
   * @description
   * States the expected format without the refused value.
   *
   * @constructor
   */
  public constructor() {
    super('A one-time code is exactly 6 digits.');
  }
  // #endregion
}

/**
 * Class InvalidCodeValidityError
 *
 * @description
 * A code stops working after it was issued: `expiresAt` comes after `occurredAt` in
 * `one-time-code.issued.v1`, and both are valid instants.
 */
export class InvalidCodeValidityError extends DomainError {
  // #region Constructor
  /**
   * Constructor
   *
   * @description
   * States the expected order of the two instants.
   *
   * @constructor
   */
  public constructor() {
    super('A code expires after it was issued.');
  }
  // #endregion
}
