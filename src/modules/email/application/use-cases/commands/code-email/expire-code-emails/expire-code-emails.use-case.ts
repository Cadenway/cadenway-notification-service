import type { Clock } from '../../../../ports/outbound/time/code-email/clock.port.js';
import type { CodeEmailDeliveries } from '../../../../ports/outbound/persistence/code-email/code-email-deliveries.port.js';
import type { CodeEmailUnitOfWork } from '../../../../ports/outbound/persistence/code-email/code-email-unit-of-work.port.js';
import type { ExpireCodeEmailsResult } from './expire-code-emails.output.js';

/**
 * Class ExpireCodeEmails
 *
 * @description
 * The sweep of the code e-mails, run by a schedule: every delivery still `queued` whose code
 * expired is settled `skipped` for `expired`, and its code and address are deleted, in one
 * transaction. The send log, not the job queue, is the source of truth (cw-jobs): this catches a
 * job deleted before it started, a last attempt failed by a crash or a timeout, a mark that failed.
 * Idempotent: a second sweep finds nothing to settle.
 */
export class ExpireCodeEmails {
  // #region Properties
  /**
   * Property unitOfWork
   *
   * @description
   * The transaction of the sweep.
   *
   * @type {CodeEmailUnitOfWork}
   * @readonly
   */
  private readonly unitOfWork: CodeEmailUnitOfWork;

  /**
   * Property deliveries
   *
   * @description
   * The send log and the pending contents.
   *
   * @type {CodeEmailDeliveries}
   * @readonly
   */
  private readonly deliveries: CodeEmailDeliveries;

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
   * @param {CodeEmailUnitOfWork} unitOfWork - The transaction of the sweep.
   * @param {CodeEmailDeliveries} deliveries - The send log and the pending contents.
   * @param {Clock} clock - The current instant.
   * @constructor
   */
  public constructor(
    unitOfWork: CodeEmailUnitOfWork,
    deliveries: CodeEmailDeliveries,
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
   * Settles the deliveries whose code expired.
   *
   * @returns {Promise<ExpireCodeEmailsResult>} How many were settled, once committed.
   */
  public async execute(): Promise<ExpireCodeEmailsResult> {
    const now: Date = this.clock.now();
    const expired: number = await this.unitOfWork.run(() => this.deliveries.expireStale(now));
    return { expired };
  }
  // #endregion
}
