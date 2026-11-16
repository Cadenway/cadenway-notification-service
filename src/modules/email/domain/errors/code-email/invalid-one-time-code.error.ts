import { DomainError } from './domain.error.js';

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
