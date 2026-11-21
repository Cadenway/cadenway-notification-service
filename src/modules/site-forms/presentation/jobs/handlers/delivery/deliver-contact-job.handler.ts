import type { Job, JobsService } from '@cadenway/nest-jobs';
import type { OnApplicationBootstrap } from '@nestjs/common';
import { z } from 'zod';

import type { DeliverContact } from '../../../../application/use-cases/commands/delivery/deliver-contact/deliver-contact.use-case.js';

const contactJobPayload = z.strictObject({ submissionId: z.uuidv7() });

/** Runs durable support deliveries without accepting organization or contact data from jobs. */
export class DeliverContactJobHandler implements OnApplicationBootstrap {
  // #region Constructor
  /** Receives the same queue name and maximum attempt count used at provisioning. */
  public constructor(
    private readonly jobs: Pick<JobsService, 'work'>,
    private readonly delivery: Pick<DeliverContact, 'execute'>,
    private readonly queueName: string,
    private readonly maxAttempts: number,
  ) {}
  // #endregion

  // #region Methods
  /** Registers the handler on the provisioned support queue. */
  public async onApplicationBootstrap(): Promise<void> {
    await this.jobs.work(this.queueName, (job: Job) => this.handle(job));
  }

  /** Validates the job and delegates its attempt without propagating payload or provider errors. */
  public async handle(job: Job): Promise<void> {
    const payload = contactJobPayload.safeParse(job.payload);
    if (job.organizationId !== null || !payload.success) {
      throw new Error('Invalid site contact delivery job.');
    }

    try {
      await this.delivery.execute({
        submissionId: payload.data.submissionId,
        lastAttempt: job.attempt >= this.maxAttempts,
        signal: job.signal,
      });
    } catch {
      throw new Error('Site contact delivery failed.');
    }
  }
  // #endregion
}
