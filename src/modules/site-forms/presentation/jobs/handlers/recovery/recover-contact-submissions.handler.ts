import type { Job, JobsService } from '@cadenway/nest-jobs';
import type { OnApplicationBootstrap } from '@nestjs/common';

import type { RecoverContactSubmissions } from '../../../../application/use-cases/commands/recovery/recover-contact-submissions/recover-contact-submissions.use-case.js';

/** Schedules a global Contact sweep with an empty payload. */
export class RecoverContactSubmissionsHandler implements OnApplicationBootstrap {
  // #region Constructor
  /** Uses the provisioned queue and its UTC schedule. */
  public constructor(
    private readonly jobs: Pick<JobsService, 'work' | 'schedule'>,
    private readonly recover: Pick<RecoverContactSubmissions, 'execute'>,
    private readonly queueName: string,
    private readonly cron: string,
  ) {}
  // #endregion

  // #region Methods
  /** Registers the persistent schedule and its handler on each replica. */
  public async onApplicationBootstrap(): Promise<void> {
    await this.jobs.schedule(this.queueName, this.cron, { timeZone: 'UTC' });
    await this.jobs.work(this.queueName, (job: Job) => this.handle(job));
  }

  /** Rejects jobs that were not created with the schedule's system scope and empty shape. */
  public async handle(job: Job): Promise<void> {
    if (job.organizationId !== null || job.payload !== null) {
      throw new Error('Invalid site contact recovery job.');
    }
    try {
      job.signal.throwIfAborted();
      await this.recover.execute();
    } catch {
      throw new Error('Site contact recovery failed.');
    }
  }
  // #endregion
}
