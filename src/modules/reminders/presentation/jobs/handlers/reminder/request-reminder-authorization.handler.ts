import { runWithOrganizationContext } from '@cadenway/nest-common';
import type { Job, JobsService } from '@cadenway/nest-jobs';
import type { OnApplicationBootstrap } from '@nestjs/common';
import { z } from 'zod';

import type { RequestReminderAuthorization } from '../../../../application/use-cases/commands/reminder/request-reminder-authorization/request-reminder-authorization.use-case.js';

const schedule = z.strictObject({
  reminderId: z.uuid(),
  userId: z.uuid(),
  scheduleVersion: z.number().int().min(1),
  retryCount: z.number().int().min(0).max(10),
  previousAttemptId: z.uuid().nullable(),
});

/** Starts a redacted Task authorization for the exact schedule stored in the job. */
export class RequestReminderAuthorizationHandler implements OnApplicationBootstrap {
  // #region Constructor
  /** Binds the durable worker and the tenant-scoped application operation. */
  public constructor(
    private readonly jobs: JobsService,
    private readonly requestAuthorization: RequestReminderAuthorization,
    private readonly queue: string,
  ) {}
  // #endregion

  // #region Methods
  /** Registers the durable reminder worker. */
  public async onApplicationBootstrap(): Promise<void> {
    await this.jobs.work(this.queue, (job) => this.handle(job));
  }

  /** Re-enters the job's tenant before making the authorization decision request. */
  public async handle(job: Job): Promise<void> {
    const organizationId = z.uuid().parse(job.organizationId);
    const input = schedule.parse(job.payload);
    job.signal.throwIfAborted();
    await runWithOrganizationContext(
      { organizationId, actor: { type: 'system', id: null }, role: null, scopes: [] },
      () =>
        this.requestAuthorization.execute({
          ...input,
          organizationId,
          expiresAt: Date.now() + 30_000,
        }),
    );
  }
  // #endregion
}
