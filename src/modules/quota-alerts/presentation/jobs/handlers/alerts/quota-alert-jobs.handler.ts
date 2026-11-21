import { quotaThresholdReachedV1Schema } from '@cadenway/contracts/events/billing-service';
import { runWithOrganizationContext } from '@cadenway/nest-common';
import type { Job, JobsService } from '@cadenway/nest-jobs';
import type { OnApplicationBootstrap } from '@nestjs/common';
import { z } from 'zod';

import type { PlanQuotaAlertPage } from '../../../../application/use-cases/commands/alerts/plan-quota-alert-page/plan-quota-alert-page.use-case.js';
import type { SendQuotaAlert } from '../../../../application/use-cases/commands/alerts/send-quota-alert/send-quota-alert.use-case.js';
import type { SendQuotaInboxAlert } from '../../../../application/use-cases/commands/alerts/send-quota-inbox-alert/send-quota-inbox-alert.use-case.js';

const alert = quotaThresholdReachedV1Schema
  .pick({ metric: true, thresholdPercent: true, used: true, limit: true })
  .extend({ eventId: z.uuid() });
const payload = z.discriminatedUnion('kind', [
  z.strictObject({
    kind: z.literal('page'),
    alert,
    cursor: z.string().min(1).max(1_024).nullable(),
  }),
  z.strictObject({ kind: z.literal('deliver'), alert, userId: z.uuid() }),
  z.strictObject({ kind: z.literal('in-app'), sourceEventId: z.uuid(), userId: z.uuid() }),
]);

/** Maps one bounded, tenant-qualified queue attempt to a quota command. */
export class QuotaAlertJobsHandler implements OnApplicationBootstrap {
  // #region Constructor
  /** Binds workers that perform HTTP outside the source event transaction. */
  public constructor(
    private readonly jobs: Pick<JobsService, 'work'>,
    private readonly plan: Pick<PlanQuotaAlertPage, 'execute'>,
    private readonly send: Pick<SendQuotaAlert, 'execute'>,
    private readonly inbox: Pick<SendQuotaInboxAlert, 'execute'>,
    private readonly queue: string,
  ) {}
  // #endregion

  // #region Methods
  /** Starts work only once Organization and Identity authority are provisioned. */
  public async onApplicationBootstrap(): Promise<void> {
    await this.jobs.work(this.queue, (job) => this.handle(job));
  }

  /** Uses the organization from the trusted queue envelope. */
  public async handle(job: Job): Promise<void> {
    const parsed = payload.safeParse(job.payload);
    const { organizationId, signal } = job;
    if (organizationId === null || !parsed.success) {
      throw new Error('The quota alert job has an invalid organization or payload.');
    }
    signal.throwIfAborted();
    const input = parsed.data;
    await runWithOrganizationContext(
      { organizationId, actor: { type: 'system', id: null }, role: null, scopes: [] },
      () => {
        if (input.kind === 'page') {
          return this.plan.execute(
            { organizationId, alert: input.alert, cursor: input.cursor },
            signal,
          );
        }
        if (input.kind === 'in-app') {
          return this.inbox.execute(
            { organizationId, recipientId: input.userId, sourceEventId: input.sourceEventId },
            signal,
          );
        }
        return this.send.execute(
          { organizationId, userId: input.userId, occurrenceId: job.id, alert: input.alert },
          signal,
        );
      },
    );
  }
  // #endregion
}
