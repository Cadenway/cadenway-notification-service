import { InvalidSendWindowError } from '../../errors/security-email/invalid-send-window.error.js';

/**
 * Constant MINUTE_MS
 *
 * @description
 * One minute, in milliseconds.
 *
 * @type {number}
 */
const MINUTE_MS: number = 60_000;

/**
 * Constant MAX_WINDOW_MS
 *
 * @description
 * Longest window accepted, in milliseconds: a day. It bounds how long the address, the device and
 * a reset token wait in this service before the sweep deletes them, and matches the check
 * constraint of `security_email_deliveries`.
 *
 * @type {number}
 */
const MAX_WINDOW_MS: number = 86_400_000;

/**
 * Class SendWindow
 *
 * @description
 * When a security e-mail may leave: from the fact it reports (`occurredAt` of the event) until
 * `sendBefore`. For the reset link, `sendBefore` is the expiry of the link (30 minutes in the
 * contract of `password-reset-link.issued.v1`): a link that stopped working is never sent. For a
 * notice, it is a day later (`noticeWindow`): past that, the e-mail is no longer worth sending
 * and its personal data no longer worth keeping.
 */
export class SendWindow {
  // #region Properties
  /**
   * Property occurredAt
   *
   * @description
   * When the reported fact happened.
   *
   * @type {Date}
   * @readonly
   */
  public readonly occurredAt: Date;

  /**
   * Property sendBefore
   *
   * @description
   * When the window closes, strictly after `occurredAt` and at most a day later.
   *
   * @type {Date}
   * @readonly
   */
  public readonly sendBefore: Date;

  /**
   * Property minutes
   *
   * @description
   * Length of the window in whole minutes and at least 1: the "30" of "Le lien expire dans 30
   * minutes". Rounded, so a few milliseconds between the two instants of the event do not turn 30
   * minutes into 29.
   *
   * @type {number}
   */
  public get minutes(): number {
    return Math.max(
      1,
      Math.round((this.sendBefore.getTime() - this.occurredAt.getTime()) / MINUTE_MS),
    );
  }
  // #endregion

  // #region Constructor
  /**
   * Constructor
   *
   * @description
   * Keeps two instants already checked by `between`.
   *
   * @param {Date} occurredAt - When the fact happened.
   * @param {Date} sendBefore - When the window closes.
   * @constructor
   */
  private constructor(occurredAt: Date, sendBefore: Date) {
    this.occurredAt = occurredAt;
    this.sendBefore = sendBefore;
  }
  // #endregion

  // #region Methods
  /**
   * Method between
   *
   * @description
   * Builds a window. The instants are copied, so the caller cannot change them afterwards.
   *
   * @param {Date} occurredAt - When the fact happened.
   * @param {Date} sendBefore - When the window closes.
   * @returns {SendWindow} The window.
   * @throws {InvalidSendWindowError} When an instant is invalid, or the window does not close
   * after the fact and within a day.
   */
  public static between(occurredAt: Date, sendBefore: Date): SendWindow {
    const start: number = occurredAt.getTime();
    const end: number = sendBefore.getTime();
    if (Number.isNaN(start) || Number.isNaN(end) || end <= start || end - start > MAX_WINDOW_MS) {
      throw new InvalidSendWindowError();
    }
    return new SendWindow(new Date(start), new Date(end));
  }

  /**
   * Method isClosedAt
   *
   * @description
   * Whether the e-mail may no longer leave at an instant: from `sendBefore` on, as identity-service
   * refuses a reset link from its expiry on (`auth.reset-link-expired` of the public auth
   * contract).
   *
   * @param {Date} now - The instant to check.
   * @returns {boolean} `true` from `sendBefore` on.
   */
  public isClosedAt(now: Date): boolean {
    return now.getTime() >= this.sendBefore.getTime();
  }
  // #endregion
}
