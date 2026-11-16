import type { JobWorkerRegistry } from '@cadenway/nest-jobs/runtime';
import type { Job } from '@cadenway/nest-jobs/runtime';
import { Logger } from '@nestjs/common';
import type { OnApplicationBootstrap } from '@nestjs/common';
import { z } from 'zod';
import type { SendCodeEmail } from '../../../../application/use-cases/commands/code-email/send-code-email/send-code-email.use-case.js';
import type { SendCodeEmailOutput } from '../../../../application/use-cases/commands/code-email/send-code-email/send-code-email.output.js';

/**
 * Constant jobPayloadSchema
 *
 * @description
 * Payload of a job of `email.send-code`, as `JobsCodeEmailQueue` enqueues it: the id of the
 * delivery only. The stored payload comes back after a JSON round trip, so it is read again.
 *
 * @type {z.ZodType<{ readonly deliveryId: string }>}
 */
const jobPayloadSchema: z.ZodType<{ readonly deliveryId: string }> = z.object({
  deliveryId: z.uuid(),
});

/**
 * Class SendCodeEmailHandler
 *
 * @description
 * Works the jobs of `email.send-code`, one per code e-mail, and hands each attempt to
 * `SendCodeEmail`. pg-boss retries a failed attempt with backoff, five attempts in all
 * (`src/config/job-queues.ts`); the last one that fails marks the delivery `failed`, and the job
 * moves to `email.send-code.dead-letter`, which the dead-letter watch of the kit counts in an
 * error line. The job carries the id of the delivery only. The signal of the attempt reaches the
 * use case, which does not hand the e-mail to the SMTP server once pg-boss gave up on the attempt.
 *
 * Each attempt is logged at `info` with ids only: never the code, the address or the name.
 */
export class SendCodeEmailHandler implements OnApplicationBootstrap {
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
  private readonly logger: Logger = new Logger(SendCodeEmailHandler.name);

  /**
   * Property jobs
   *
   * @description
   * The worker registry of the kit.
   *
   * @type {JobWorkerRegistry}
   * @readonly
   */
  private readonly jobs: JobWorkerRegistry;

  /**
   * Property sendCodeEmail
   *
   * @description
   * The use case each attempt runs.
   *
   * @type {SendCodeEmail}
   * @readonly
   */
  private readonly sendCodeEmail: SendCodeEmail;

  /**
   * Property queueName
   *
   * @description
   * The queue of code emails.
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
   * Receives the worker registry and the use case.
   *
   * @param {JobWorkerRegistry} jobs - The worker registry of the kit.
   * @param {SendCodeEmail} sendCodeEmail - The use case.
   * @param {string} queueName - The queue of code emails.
   * @param {number} maxAttempts - The maximum number of attempts declared for the queue.
   * @constructor
   */
  public constructor(
    jobs: JobWorkerRegistry,
    sendCodeEmail: SendCodeEmail,
    queueName: string,
    maxAttempts: number,
  ) {
    this.jobs = jobs;
    this.sendCodeEmail = sendCodeEmail;
    this.queueName = queueName;
    this.maxAttempts = maxAttempts;
  }
  // #endregion

  // #region Methods
  /**
   * Method onApplicationBootstrap
   *
   * @description
   * Registers the worker of the queue, polled every second: a code is waited for on a screen.
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
    const result: SendCodeEmailOutput = await this.sendCodeEmail.execute({
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
        this.logger.log({ ...fields, template: result.template }, 'code e-mail sent');
        break;
      case 'skipped':
        this.logger.log({ ...fields, reason: result.reason }, 'code e-mail skipped');
        break;
      case 'failed':
        this.logger.error(fields, 'code e-mail lost its content before it was sent');
        break;
      case 'already-handled':
        this.logger.log({ ...fields, status: result.status }, 'code e-mail already settled');
        break;
      case 'missing':
        this.logger.warn(fields, 'code e-mail delivery not found');
        break;
    }
  }
  // #endregion
}
