import type { SecurityEmailDeliveries } from '../../../../ports/outbound/persistence/security-email/security-email-deliveries.port.js';
import type { SecurityEmailUnitOfWork } from '../../../../ports/outbound/persistence/security-email/security-email-unit-of-work.port.js';
import type { Clock } from '../../../../ports/outbound/time/code-email/clock.port.js';
import type { ExpireSecurityEmailsOutput } from './expire-security-emails.output.js';

/**
 * Class ExpireSecurityEmails
 *
 * @description
 * The sweep of the security e-mails, run by a schedule: every delivery still `queued` whose window
 * closed is settled `skipped` for `expired`, and its recipient, details and reset token are
 * deleted, in one transaction. The send log, not the job queue, is the source of truth (cw-jobs):
 * this catches a job deleted before it started, a last attempt failed by a crash or a timeout, a
 * mark that failed. Idempotent: a second sweep finds nothing to settle.
 */
export class ExpireSecurityEmails {
  // #region Properties
  /**
   * Property unitOfWork
   *
   * @description
   * The transaction of the sweep.
   *
   * @type {SecurityEmailUnitOfWork}
   * @readonly
   */
  private readonly unitOfWork: SecurityEmailUnitOfWork;

  /**
   * Property deliveries
   *
   * @description
   * The send log and the pending contents.
   *
   * @type {SecurityEmailDeliveries}
   * @readonly
   */
  private readonly deliveries: SecurityEmailDeliveries;

  /**
   * Property clock
   *
   * @description
   * The current instant.
   *
   * @type {Clock}
   * @readonly
   */
  private readonly clock: Clock;
  // #endregion

  // #region Constructor
  /**
   * Constructor
   *
   * @description
   * Receives the ports of the use case.
   *
   * @param {SecurityEmailUnitOfWork} unitOfWork - The transaction of the sweep.
   * @param {SecurityEmailDeliveries} deliveries - The send log and the pending contents.
   * @param {Clock} clock - The current instant.
   * @constructor
   */
  public constructor(
    unitOfWork: SecurityEmailUnitOfWork,
    deliveries: SecurityEmailDeliveries,
    clock: Clock,
  ) {
    this.unitOfWork = unitOfWork;
    this.deliveries = deliveries;
    this.clock = clock;
  }
  // #endregion

  // #region Methods
  /**
   * Method execute
   *
   * @description
   * Settles the deliveries whose window closed.
   *
   * @returns {Promise<ExpireSecurityEmailsOutput>} How many were settled, once committed.
   */
  public async execute(): Promise<ExpireSecurityEmailsOutput> {
    const now: Date = this.clock.now();
    const expired: number = await this.unitOfWork.run(() => this.deliveries.expireStale(now));
    return { expired };
  }
  // #endregion
}
