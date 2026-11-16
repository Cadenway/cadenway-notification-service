/**
 * Class AttemptAbandonedError
 *
 * @description
 * The job system gave up on the attempt before the e-mail was handed to the SMTP server.
 */
export class AttemptAbandonedError extends Error {
  // #region Constructor
  /**
   * Constructor
   *
   * @description
   * Names the error after its class.
   *
   * @constructor
   */
  public constructor() {
    super('The attempt was abandoned before the e-mail was handed to the SMTP server.');
    this.name = 'AttemptAbandonedError';
  }
  // #endregion
}
