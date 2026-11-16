import type { JobScheduler } from '@cadenway/nest-jobs/runtime';
import type { OnApplicationBootstrap } from '@nestjs/common';

/** Registers the persisted expiry schedule independently of the process that works its jobs. */
export class ExpireCodeEmailsScheduleHandler implements OnApplicationBootstrap {
  // #region Constructor
  /** Receives the scheduling capability, queue and cron expression. */
  public constructor(
    private readonly jobs: Pick<JobScheduler, 'schedule'>,
    private readonly queue: string,
    private readonly cron: string,
  ) {}
  // #endregion

  // #region Methods
  /** Registers or updates the existing schedule in UTC. */
  public onApplicationBootstrap(): Promise<void> {
    return this.jobs.schedule(this.queue, this.cron, { timeZone: 'UTC' });
  }
  // #endregion
}
