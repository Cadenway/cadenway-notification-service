import type { JobsService } from '@cadenway/nest-jobs';
import { Logger } from '@nestjs/common';
import type { OnApplicationBootstrap } from '@nestjs/common';
import type { ExpireCodeEmails } from '../../../../application/use-cases/commands/code-email/expire-code-emails/expire-code-emails.use-case.js';
import type { ExpireCodeEmailsResult } from '../../../../application/use-cases/commands/code-email/expire-code-emails/expire-code-emails.output.js';

/**
 * Class ExpireCodeEmailsHandler
 *
 * @description
 * Schedules and works the sweep of the code e-mails (`email.expire-codes`, every 5 minutes in
 * UTC). Every replica registers the same schedule at start-up, which replaces it: pg-boss creates
 * one job per occurrence whatever the number of replicas. Each run hands over to
 * `ExpireCodeEmails` and logs how many deliveries it settled, when there were some.
 */
export class ExpireCodeEmailsHandler implements OnApplicationBootstrap {
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
  private readonly logger: Logger = new Logger(ExpireCodeEmailsHandler.name);

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
   * Property expireCodeEmails
   *
   * @description
   * The use case each run calls.
   *
   * @type {ExpireCodeEmails}
   * @readonly
   */
  private readonly expireCodeEmails: ExpireCodeEmails;

  /**
   * Property queueName
   *
   * @description
   * The queue of expiry sweeps.
   *
   * @type {string}
   * @readonly
   */
  private readonly queueName: string;

  /**
   * Property cron
   *
   * @description
   * The UTC cron expression for the sweep.
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
   * @param {ExpireCodeEmails} expireCodeEmails - The use case.
   * @param {string} queueName - The queue of expiry sweeps.
   * @param {string} cron - The UTC cron expression for the sweep.
   * @constructor
   */
  public constructor(
    jobs: JobsService,
    expireCodeEmails: ExpireCodeEmails,
    queueName: string,
    cron: string,
  ) {
    this.jobs = jobs;
    this.expireCodeEmails = expireCodeEmails;
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
    await this.jobs.schedule(this.queueName, this.cron, {
      timeZone: 'UTC',
    });
    await this.jobs.work(this.queueName, (): Promise<void> => this.handle());
  }

  /**
   * Method handle
   *
   * @description
   * Runs one sweep. A rejection fails the run, which pg-boss retries twice.
   *
   * @returns {Promise<void>} Settles once the sweep is committed.
   */
  public async handle(): Promise<void> {
    const result: ExpireCodeEmailsResult = await this.expireCodeEmails.execute();
    if (result.expired > 0) {
      this.logger.log({ expired: result.expired }, 'expired code e-mails settled');
    }
  }
  // #endregion
}
