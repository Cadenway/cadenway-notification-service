import type { JobsService } from '@cadenway/nest-jobs';
import { Logger } from '@nestjs/common';
import type { OnApplicationBootstrap } from '@nestjs/common';
import type { ExpireInvitationEmails } from '../../../../application/use-cases/commands/invitation-email/expire-invitation-emails/expire-invitation-emails.use-case.js';
import type { ExpireInvitationEmailsOutput } from '../../../../application/use-cases/commands/invitation-email/expire-invitation-emails/expire-invitation-emails.output.js';

/**
 * Class ExpireInvitationEmailsHandler
 *
 * @description
 * Schedules and works the sweep of the invitation e-mails (`email.expire-invitations`, every hour
 * in UTC). Every replica registers the same schedule at start-up, which replaces it: pg-boss
 * creates one job per occurrence whatever the number of replicas. Each run hands over to
 * `ExpireInvitationEmails` and logs how many deliveries it settled, when there were some.
 */
export class ExpireInvitationEmailsHandler implements OnApplicationBootstrap {
  // #region Properties
  /**
   * Property logger
   *
   * @description
   * Logger of the handler, routed to the JSON logs of the kit.
   *
   * @type {Logger}
   * @readonly
   */
  private readonly logger: Logger = new Logger(ExpireInvitationEmailsHandler.name);

  /**
   * Property jobs
   *
   * @description
   * The jobs of `JobsModule`.
   *
   * @type {JobsService}
   * @readonly
   */
  private readonly jobs: JobsService;

  /**
   * Property expireInvitationEmails
   *
   * @description
   * The use case each run calls.
   *
   * @type {ExpireInvitationEmails}
   * @readonly
   */
  private readonly expireInvitationEmails: ExpireInvitationEmails;

  /**
   * Property queueName
   *
   * @description
   * The queue of the sweep.
   *
   * @type {string}
   * @readonly
   */
  private readonly queueName: string;

  /**
   * Property cron
   *
   * @description
   * The UTC cron expression of the sweep.
   *
   * @type {string}
   * @readonly
   */
  private readonly cron: string;
  // #endregion

  // #region Constructor
  /**
   * Constructor
   *
   * @description
   * Receives the jobs service and the use case.
   *
   * @param {JobsService} jobs - The jobs service of the kit.
   * @param {ExpireInvitationEmails} expireInvitationEmails - The use case.
   * @param {string} queueName - The queue of the sweep.
   * @param {string} cron - The UTC cron expression of the sweep.
   * @constructor
   */
  public constructor(
    jobs: JobsService,
    expireInvitationEmails: ExpireInvitationEmails,
    queueName: string,
    cron: string,
  ) {
    this.jobs = jobs;
    this.expireInvitationEmails = expireInvitationEmails;
    this.queueName = queueName;
    this.cron = cron;
  }
  // #endregion

  // #region Methods
  /**
   * Method onApplicationBootstrap
   *
   * @description
   * Registers the schedule and the worker of the sweep.
   *
   * @returns {Promise<void>} Settles once both are registered.
   */
  public async onApplicationBootstrap(): Promise<void> {
    await this.jobs.schedule(this.queueName, this.cron, { timeZone: 'UTC' });
    await this.jobs.work(this.queueName, (): Promise<void> => this.handle());
  }

  /**
   * Method handle
   *
   * @description
   * Runs one sweep.
   *
   * @returns {Promise<void>} Settles once the sweep is committed.
   */
  public async handle(): Promise<void> {
    const result: ExpireInvitationEmailsOutput = await this.expireInvitationEmails.execute();
    if (result.expired > 0) {
      this.logger.log({ expired: result.expired }, 'expired invitation e-mails settled');
    }
  }
  // #endregion
}
