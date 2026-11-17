import type { JobsService } from '@cadenway/nest-jobs';
import type { Job } from '@cadenway/nest-jobs';
import { Logger } from '@nestjs/common';
import type { OnApplicationBootstrap } from '@nestjs/common';
import { z } from 'zod';
import type { SendSecurityEmail } from '../../../../application/use-cases/commands/security-email/send-security-email/send-security-email.use-case.js';
import type { SendSecurityEmailOutput } from '../../../../application/use-cases/commands/security-email/send-security-email/send-security-email.output.js';

/**
 * Constant jobPayloadSchema
 *
 * @description
 * Payload of a job of `email.send-security`, as `JobsSecurityEmailQueue` enqueues it: the id of the
 * delivery only. The stored payload comes back after a JSON round trip, so it is read again.
 *
 * @type {z.ZodType<{ readonly deliveryId: string }>}
 */
const jobPayloadSchema: z.ZodType<{ readonly deliveryId: string }> = z.object({
  deliveryId: z.uuid(),
});

/**
 * Class SendSecurityEmailHandler
 *
 * @description
 * Works the jobs of `email.send-security`, one per security e-mail, and hands each attempt to
 * `SendSecurityEmail`. pg-boss retries a failed attempt with backoff, five attempts in all
 * (`src/config/job-queues.ts`); the last one that fails marks the delivery `failed`, and the job
 * moves to `email.send-security.dead-letter`, which the dead-letter watch of the kit counts in an
 * error line. The job carries the id of the delivery only. The signal of the attempt reaches the
 * use case, which does not hand the e-mail to the SMTP server once pg-boss gave up on the attempt.
 *
 * Each attempt is logged at `info` with ids only: never the address, the device or a reset token.
 */
export class SendSecurityEmailHandler implements OnApplicationBootstrap {
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
  private readonly logger: Logger = new Logger(SendSecurityEmailHandler.name);

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
   * Property sendSecurityEmail
   *
   * @description
   * The use case each attempt runs.
   *
   * @type {SendSecurityEmail}
   * @readonly
   */
  private readonly sendSecurityEmail: SendSecurityEmail;

  /**
   * Property queueName
   *
   * @description
   * The queue of security e-mails.
   *
   * @type {string}
   * @readonly
   */
  private readonly queueName: string;

  /**
   * Property maxAttempts
   *
   * @description
   * The maximum number of attempts declared for the queue.
   *
   * @type {number}
   * @readonly
   */
  private readonly maxAttempts: number;
  // #endregion

  // #region Constructor
  /**
   * Constructor
   *
   * @description
   * Receives the jobs service and the use case.
   *
   * @param {JobsService} jobs - The jobs service of the kit.
   * @param {SendSecurityEmail} sendSecurityEmail - The use case.
   * @param {string} queueName - The queue of security e-mails.
   * @param {number} maxAttempts - The maximum number of attempts declared for the queue.
   * @constructor
   */
  public constructor(
    jobs: JobsService,
    sendSecurityEmail: SendSecurityEmail,
    queueName: string,
    maxAttempts: number,
  ) {
    this.jobs = jobs;
    this.sendSecurityEmail = sendSecurityEmail;
    this.queueName = queueName;
    this.maxAttempts = maxAttempts;
  }
  // #endregion

  // #region Methods
  /**
   * Method onApplicationBootstrap
   *
   * @description
   * Registers the worker of the queue, polled every second: a reset link is waited for on a screen.
   *
   * @returns {Promise<void>} Settles once the worker is registered.
   */
  public async onApplicationBootstrap(): Promise<void> {
    await this.jobs.work(this.queueName, (job: Job): Promise<void> => this.handle(job), {
      pollingIntervalSeconds: 1,
    });
  }

  /**
   * Method handle
   *
   * @description
   * Runs one attempt. A rejection fails the attempt, which pg-boss retries until the last one.
   *
   * @param {Job} job - The job, with its attempt number.
   * @returns {Promise<void>} Settles once the attempt is settled.
   * @throws {Error} When the payload is not a delivery id, or the e-mail could not be sent.
   */
  public async handle(job: Job): Promise<void> {
    const { deliveryId }: { readonly deliveryId: string } = jobPayloadSchema.parse(job.payload);
    const result: SendSecurityEmailOutput = await this.sendSecurityEmail.execute({
      deliveryId,
      lastAttempt: job.attempt >= this.maxAttempts,
      signal: job.signal,
    });
    const fields: Readonly<Record<string, string | number>> = {
      deliveryId,
      jobId: job.id,
      attempt: job.attempt,
    };
    switch (result.outcome) {
      case 'sent':
        this.logger.log({ ...fields, template: result.template }, 'security e-mail sent');
        break;
      case 'skipped':
        this.logger.log({ ...fields, reason: result.reason }, 'security e-mail skipped');
        break;
      case 'failed':
        this.logger.error(fields, 'security e-mail lost its content before it was sent');
        break;
      case 'already-handled':
        this.logger.log({ ...fields, status: result.status }, 'security e-mail already settled');
        break;
      case 'missing':
        this.logger.warn(fields, 'security e-mail delivery not found');
        break;
    }
  }
  // #endregion
}
