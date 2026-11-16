import type { Clock } from '../../../application/ports/outbound/time/code-email/clock.port.js';

/**
 * Class SystemClock
 *
 * @description
 * `Clock` on the clock of the host.
 */
export class SystemClock implements Clock {
  // #region Methods
  /**
   * Method now
   *
   * @description
   * The current instant of the host.
   *
   * @returns {Date} A new `Date`.
   */
  public now(): Date {
    return new Date();
  }
  // #endregion
}
