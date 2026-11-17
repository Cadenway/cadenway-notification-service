import { runWithOrganizationContext } from '@cadenway/nest-common';
import type { JobsService } from '@cadenway/nest-jobs';
import type { Job } from '@cadenway/nest-jobs';
import { Logger } from '@nestjs/common';
import type { OnApplicationBootstrap } from '@nestjs/common';
import { z } from 'zod';
import type { SendInvitationEmail } from '../../../../application/use-cases/commands/invitation-email/send-invitation-email/send-invitation-email.use-case.js';
import type { SendInvitationEmailOutput } from '../../../../application/use-cases/commands/invitation-email/send-invitation-email/send-invitation-email.output.js';

/**
 * Constant jobSchema
 *
 * @description
 * What a job of `email.send-invitation` must hold, as `JobsInvitationEmailQueue` enqueues it: the
 * id of the delivery as payload, and the organization of the tenant transaction that enqueued it.
 * The stored payload comes back after a JSON round trip, so it is read again.
 *
 * @type {z.ZodType<{ readonly payload: { readonly deliveryId: string }; readonly organizationId: string }>}
 */
const jobSchema: z.ZodType<{
  readonly payload: { readonly deliveryId: string };
  readonly organizationId: string;
}> = z.object({
  payload: z.object({ deliveryId: z.uuid() }),
  organizationId: z.uuid(),
});

/**
 * Class SendInvitationEmailHandler
 *
 * @description
 * Works the jobs of `email.send-invitation`, one per invitation e-mail, and hands each attempt to
 * `SendInvitationEmail`, inside the organization context of the job: the organization the service
 * itself recorded when it enqueued the job, in the tenant transaction of the event. pg-boss retries
 * a failed attempt with backoff, five attempts in all (`src/config/job-queues.ts`); the last one
 * that fails marks the delivery `failed`, and the job moves to `email.send-invitation.dead-letter`,
 * which the dead-letter watch of the kit counts in an error line. The signal of the attempt reaches
 * the use case, which does not hand the e-mail to the SMTP server once pg-boss gave up on it.
 *
 * Each attempt is logged at `info` with ids only: never the address or a name.
 */
export class SendInvitationEmailHandler implements OnApplicationBootstrap {
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
  private readonly logger: Logger = new Logger(SendInvitationEmailHandler.name);

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
   * Property sendInvitationEmail
   *
   * @description
   * The use case each attempt runs.
   *
   * @type {SendInvitationEmail}
   * @readonly
   */
  private readonly sendInvitationEmail: SendInvitationEmail;

  /**
   * Property queueName
   *
   * @description
   * The queue of the invitation e-mails.
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
   * @param {SendInvitationEmail} sendInvitationEmail - The use case.
   * @param {string} queueName - The queue of the invitation e-mails.
   * @param {number} maxAttempts - The maximum number of attempts declared for the queue.
   * @constructor
   */
  public constructor(
    jobs: JobsService,
    sendInvitationEmail: SendInvitationEmail,
    queueName: string,
    maxAttempts: number,
  ) {
    this.jobs = jobs;
    this.sendInvitationEmail = sendInvitationEmail;
    this.queueName = queueName;
    this.maxAttempts = maxAttempts;
  }
  // #endregion

  // #region Methods
  /**
   * Method onApplicationBootstrap
   *
   * @description
   * Registers the worker of the queue, polled every two seconds, the default of the kit: nobody
   * waits for an invitation on a screen.
   *
   * @returns {Promise<void>} Settles once the worker is registered.
   */
  public async onApplicationBootstrap(): Promise<void> {
    await this.jobs.work(this.queueName, (job: Job): Promise<void> => this.handle(job), {
      pollingIntervalSeconds: 2,
    });
  }

  /**
   * Method handle
   *
   * @description
   * Runs one attempt in the organization of the job. A rejection fails the attempt, which pg-boss
   * retries until the last one.
   *
   * @param {Job} job - The job, with its organization and its attempt number.
   * @returns {Promise<void>} Settles once the attempt is settled.
   * @throws {Error} When the job carries no delivery id or no organization, or the e-mail could
   * not be sent.
   */
  public async handle(job: Job): Promise<void> {
    const {
      payload: { deliveryId },
      organizationId,
    }: { readonly payload: { readonly deliveryId: string }; readonly organizationId: string } =
      jobSchema.parse({ payload: job.payload, organizationId: job.organizationId });
    const result: SendInvitationEmailOutput = await runWithOrganizationContext(
      { organizationId, actor: { type: 'system', id: null }, role: null, scopes: [] },
      () =>
        this.sendInvitationEmail.execute({
          deliveryId,
          lastAttempt: job.attempt >= this.maxAttempts,
          signal: job.signal,
        }),
    );
    const fields: Readonly<Record<string, string | number>> = {
      deliveryId,
      organizationId,
      jobId: job.id,
      attempt: job.attempt,
    };
    switch (result.outcome) {
      case 'sent':
        this.logger.log(fields, 'invitation e-mail sent');
        break;
      case 'skipped':
        this.logger.log({ ...fields, reason: result.reason }, 'invitation e-mail skipped');
        break;
      case 'failed':
        this.logger.error(fields, 'invitation e-mail lost its content before it was sent');
        break;
      case 'already-handled':
        this.logger.log({ ...fields, status: result.status }, 'invitation e-mail already settled');
        break;
      case 'missing':
        this.logger.warn(fields, 'invitation e-mail delivery not found');
        break;
    }
  }
  // #endregion
}
