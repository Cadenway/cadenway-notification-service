import { runWithOrganizationContext } from '@cadenway/nest-common';
import type { Job, JobsService } from '@cadenway/nest-jobs';
import type { OnApplicationBootstrap } from '@nestjs/common';
import { z } from 'zod';

import { INBOX_AUTHORIZATION_MAX_ATTEMPTS } from '../../../../application/models/inbox/inbox-authorization-retry.model.js';
import type { RetryInboxDeliveryAuthorization } from '../../../../application/use-cases/commands/inbox/retry-inbox-delivery-authorization/retry-inbox-delivery-authorization.use-case.js';

const retry = z.strictObject({
  attemptId: z.uuid(),
  retryCount: z.number().int().min(1).max(INBOX_AUTHORIZATION_MAX_ATTEMPTS),
});

/** Receives durable authorization deadline checks for the job's tenant. */
export class RetryInboxDeliveryAuthorizationHandler implements OnApplicationBootstrap {
  // #region Constructor
  /** Binds the durable worker and the tenant-scoped retry operation. */
  public constructor(
    private readonly jobs: Pick<JobsService, 'work'>,
    private readonly retryAuthorization: Pick<RetryInboxDeliveryAuthorization, 'execute'>,
    private readonly queue: string,
  ) {}
  // #endregion

  // #region Methods
  /** Registers the Inbox authorization worker on the provisioned queue. */
  public async onApplicationBootstrap(): Promise<void> {
    await this.jobs.work(this.queue, (job) => this.handle(job));
  }

  /** Validates the job before using its tenant to open a retry transaction. */
  public async handle(job: Job): Promise<void> {
    const organizationId = z.uuid().parse(job.organizationId);
    const payload = retry.parse(job.payload);
    job.signal.throwIfAborted();
    await runWithOrganizationContext(
      { organizationId, actor: { type: 'system', id: null }, role: null, scopes: [] },
      () => this.retryAuthorization.execute({ ...payload, organizationId }),
    );
  }
  // #endregion
}
