/**
 * Interface Clock
 *
 * @description
 * The current instant, given to the use cases so that the domain never reads the time itself and
 * a test can fix it.
 */
export interface Clock {
  // #region Methods
  /**
   * Method now
   *
   * @description
   * The current instant.
   *
   * @returns {Date} A new `Date` at each call.
   */
  now(): Date;
  // #endregion
}

/**
 * Constant CLOCK
 *
 * @description
 * Injection token of the `Clock` of the email module.
 *
 * @type {unique symbol}
 */
export const CLOCK: unique symbol = Symbol('Clock');
