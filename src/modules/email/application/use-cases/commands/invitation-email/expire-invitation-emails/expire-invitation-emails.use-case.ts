import type { InvitationEmailDeliveries } from '../../../../ports/outbound/persistence/invitation-email/invitation-email-deliveries.port.js';
import type { InvitationEmailSweepUnitOfWork } from '../../../../ports/outbound/persistence/invitation-email/invitation-email-sweep-unit-of-work.port.js';
import type { Clock } from '../../../../ports/outbound/time/code-email/clock.port.js';
import type { ExpireInvitationEmailsOutput } from './expire-invitation-emails.output.js';

/**
 * Class ExpireInvitationEmails
 *
 * @description
 * The sweep of the invitation e-mails, scheduled every hour: in one transaction across
 * organizations, settles the deliveries still `queued` whose invitation expired, as `skipped` for
 * `expired`, and deletes every content whose invitation expired. A job settles its own delivery;
 * the sweep catches what a job left behind (a last attempt failed by a crash), so the address of
 * an invitee never outlives its invitation by more than an hour.
 */
export class ExpireInvitationEmails {
  // #region Properties
  /**
   * Property unitOfWork
   *
   * @description
   * The transaction of the sweep, across organizations.
   *
   * @type {InvitationEmailSweepUnitOfWork}
   * @readonly
   */
  private readonly unitOfWork: InvitationEmailSweepUnitOfWork;

  /**
   * Property deliveries
   *
   * @description
   * The send log and the pending contents.
   *
   * @type {InvitationEmailDeliveries}
   * @readonly
   */
  private readonly deliveries: InvitationEmailDeliveries;

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
   * @param {InvitationEmailSweepUnitOfWork} unitOfWork - The transaction of the sweep.
   * @param {InvitationEmailDeliveries} deliveries - The send log and the pending contents.
   * @param {Clock} clock - The current instant.
   * @constructor
   */
  public constructor(
    unitOfWork: InvitationEmailSweepUnitOfWork,
    deliveries: InvitationEmailDeliveries,
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
   * Runs one sweep.
   *
   * @returns {Promise<ExpireInvitationEmailsOutput>} How many deliveries it settled.
   */
  public async execute(): Promise<ExpireInvitationEmailsOutput> {
    const now: Date = this.clock.now();
    const expired: number = await this.unitOfWork.run(() => this.deliveries.expireStale(now));
    return { expired };
  }
  // #endregion
}
