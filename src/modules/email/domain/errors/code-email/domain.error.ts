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
