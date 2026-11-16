import { DomainError } from './domain.error.js';

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
