import { DomainError } from '../code-email/domain.error.js';

/**
 * Class InvalidSendWindowError
 *
 * @description
 * A security e-mail may leave after the fact it reports and within a day of it: `expiresAt` of a
 * reset link comes after its `occurredAt` (30 minutes in the contract), and both are valid
 * instants.
 */
export class InvalidSendWindowError extends DomainError {
  // #region Constructor
  /**
   * Constructor
   *
   * @description
   * States the expected window.
   *
   * @constructor
   */
  public constructor() {
    super('A security e-mail is sent after its event and within a day of it.');
  }
  // #endregion
}
