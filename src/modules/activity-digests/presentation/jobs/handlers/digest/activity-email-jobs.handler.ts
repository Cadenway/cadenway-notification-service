import { runWithOrganizationContext } from '@cadenway/nest-common';
import type { Job, JobsService } from '@cadenway/nest-jobs';
import type { OnApplicationBootstrap } from '@nestjs/common';
import { z } from 'zod';

import type { PlanActivityEmail } from '../../../../application/use-cases/commands/digest/plan-activity-email/plan-activity-email.use-case.js';
import type { RequestActivityAuthorization } from '../../../../application/use-cases/commands/digest/request-activity-authorization/request-activity-authorization.use-case.js';
import type { SendActivityEmail } from '../../../../application/use-cases/commands/digest/send-activity-email/send-activity-email.use-case.js';
import type { ListDueActivityOrganizations } from '../../../../application/use-cases/queries/digest/list-due-activity-organizations/list-due-activity-organizations.use-case.js';

const planningPayload = z.strictObject({
  userId: z.uuid(),
  notBeforeMs: z.number().int().nonnegative().max(8_640_000_000_000_000),
});
const senderPayload = z.strictObject({
  userId: z.uuid(),
  occurrenceId: z.uuid(),
  generation: z.number().int().min(1).max(2_147_483_647),
});
const authorizationWindowMs = 30_000;

/** Drives bounded account jobs, re-entering each tenant only to request its current Task permit. */
export class ActivityEmailJobsHandler implements OnApplicationBootstrap {
  // #region Constructor
  /** Binds the durable workers to the existing email use cases. */
  public constructor(
    private readonly jobs: Pick<JobsService, 'work'>,
    private readonly plan: Pick<PlanActivityEmail, 'execute'>,
    private readonly send: Pick<SendActivityEmail, 'execute'>,
    private readonly authorize: Pick<RequestActivityAuthorization, 'execute'>,
    private readonly organizations: Pick<ListDueActivityOrganizations, 'execute'>,
    private readonly clock: () => number,
    private readonly queues: { readonly plan: string; readonly send: string },
    private readonly enabled: boolean,
  ) {}
  // #endregion

  // #region Methods
  /** Registers one bounded worker per queue in each replica. */
  public async onApplicationBootstrap(): Promise<void> {
    if (!this.enabled) return;
    await this.jobs.work(this.queues.plan, (job) => this.handlePlan(job));
    await this.jobs.work(this.queues.send, (job) => this.handleDelivery(job));
  }

  /** Lets account policy choose a new eligible window after a delayed planning job. */
  public async handlePlan(job: Job): Promise<void> {
    const { userId, notBeforeMs } = planningPayload.parse(job.payload);
    job.signal.throwIfAborted();
    await this.plan.execute({ userId, notBeforeMs: Math.max(notBeforeMs, this.clock()) });
  }

  /** Uses the job's bounded retries while current authorization is pending. */
  public async handleDelivery(job: Job): Promise<void> {
    if (job.organizationId !== null) {
      throw new Error('An activity email occurrence job must be account-wide.');
    }
    const input = senderPayload.parse(job.payload);
    job.signal.throwIfAborted();
    if ((await this.send.execute(input, job.signal)) !== 'pending') return;

    const organizations = await this.organizations.execute(input);
    for (const organizationId of organizations) {
      job.signal.throwIfAborted();
      await runWithOrganizationContext(
        { organizationId, actor: { type: 'system', id: null }, role: null, scopes: [] },
        () =>
          this.authorize.execute({
            ...input,
            organizationId,
            expiresAt: this.clock() + authorizationWindowMs,
          }),
      );
    }
    if (organizations.length > 0) throw new Error('Activity email authorization is pending.');
  }
  // #endregion
}
