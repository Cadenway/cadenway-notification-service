import { taskAssignedV1Schema } from '@cadenway/contracts/events/task-service';
import { runWithOrganizationContext } from '@cadenway/nest-common';
import type { Job, JobsService } from '@cadenway/nest-jobs';
import type { EventEnvelope } from '@cadenway/nest-messaging';
import type { OnApplicationBootstrap } from '@nestjs/common';
import { z } from 'zod';

import type { StageActivityEmail } from '../../../../application/use-cases/commands/digest/stage-activity-email/stage-activity-email.use-case.js';

const audienceSchema = z.strictObject({
  kind: z.enum(['assignment', 'comment', 'mention', 'status-change', 'access']),
  recipientIds: z.array(z.uuid()),
});
const sourceSchema = z.strictObject({
  organizationId: z.uuid(),
  sourceEventId: z.uuid(),
  actorUserId: z.uuid().nullable(),
  taskKey: z.string().min(1),
  commentId: z.uuid().nullable(),
  status: z.string().nullable(),
});
const payloadSchema = z.strictObject({
  source: sourceSchema,
  audiences: z.array(audienceSchema).min(1),
  actor: taskAssignedV1Schema.shape.actor,
  occurredAt: z.iso.datetime({ offset: true }),
  version: z.int().nonnegative(),
});

/** Retries email candidate intake independently of the original Inbox fact. */
export class ActivityEmailSourceHandler implements OnApplicationBootstrap {
  // #region Constructor
  /** Receives the job interface, email intake use case and source receipt transaction. */
  public constructor(
    private readonly jobs: Pick<JobsService, 'work'>,
    private readonly stage: Pick<StageActivityEmail, 'execute'>,
    private readonly deduplicate: (
      envelope: EventEnvelope,
      handle: () => Promise<void>,
    ) => Promise<void>,
    private readonly queue: string,
    private readonly enabled: boolean,
  ) {}
  // #endregion

  // #region Methods
  /** Registers the worker only when activity email is enabled. */
  public async onApplicationBootstrap(): Promise<void> {
    if (this.enabled) await this.jobs.work(this.queue, (job) => this.handle(job));
  }

  /** Checks the job tenant and commits the receipt with email preferences and planned work. */
  public async handle(job: Job): Promise<void> {
    const { source, audiences, actor, occurredAt, version } = payloadSchema.parse(job.payload);
    const organizationId = job.organizationId?.toLowerCase();
    if (organizationId === undefined || organizationId !== source.organizationId.toLowerCase()) {
      throw new Error('Activity email source job must match its Inbox tenant.');
    }
    job.signal.throwIfAborted();
    await runWithOrganizationContext(
      {
        organizationId,
        actor: { type: 'system', id: 'notification-service' },
        role: null,
        scopes: [],
      },
      () =>
        this.deduplicate(
          { id: source.sourceEventId, organizationId, actor, occurredAt, version },
          async () => {
            job.signal.throwIfAborted();
            await this.stage.execute({ source, audiences });
            job.signal.throwIfAborted();
          },
        ),
    );
  }
  // #endregion
}
