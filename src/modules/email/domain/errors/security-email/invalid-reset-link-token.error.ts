import { DomainError } from '../code-email/domain.error.js';

/**
 * Class InvalidResetLinkTokenError
 *
 * @description
 * The secret of a reset link is 32 to 128 URL-safe characters (`token` of
 * `password-reset-link.issued.v1`, pattern `^[A-Za-z0-9_-]{32,128}$`).
 */
export class InvalidResetLinkTokenError extends DomainError {
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
    super('A reset link token is 32 to 128 URL-safe characters.');
  }
  // #endregion
}
