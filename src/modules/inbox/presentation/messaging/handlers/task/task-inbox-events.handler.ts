import {
  APPROVAL_DECIDED_V1,
  APPROVAL_REQUESTED_V1,
  COMMENT_CREATED_V1,
  COMMENT_UPDATED_V1,
  TASK_ACCESS_REQUEST_DECIDED_V1,
  TASK_ACCESS_REQUESTED_V1,
  TASK_ASSIGNED_V1,
  TASK_DESCRIPTION_MENTIONS_CHANGED_V1,
  TASK_NOTIFICATION_DELIVERY_AUTHORIZED_V1,
  TASK_STATUS_CHANGED_V1,
  eventSchemas,
} from '@cadenway/contracts/events/task-service';
import type {
  TaskAssignedV1,
  TaskNotificationDeliveryAuthorizedV1,
} from '@cadenway/contracts/events/task-service';
import { EventConsumers } from '@cadenway/nest-messaging';
import type { EventPayloadOf } from '@cadenway/nest-messaging';
import { Injectable } from '@nestjs/common';
import type { OnApplicationBootstrap } from '@nestjs/common';
import { z } from 'zod';

import { AcceptInboxDeliveryAuthorization } from '../../../../application/use-cases/commands/inbox/accept-inbox-delivery-authorization/accept-inbox-delivery-authorization.use-case.js';
import type { StageInboxDeliveriesInput } from '../../../../application/use-cases/commands/inbox/stage-inbox-deliveries/stage-inbox-deliveries.input.js';
import { StageInboxDeliveries } from '../../../../application/use-cases/commands/inbox/stage-inbox-deliveries/stage-inbox-deliveries.use-case.js';

const AUTHORIZATION_WINDOW_MS = 30_000;
const userIdSchema = z.uuid();

type TaskFact = Pick<TaskAssignedV1, 'id' | 'organizationId' | 'actor' | 'key'>;
type Audiences = StageInboxDeliveriesInput['audiences'];
type Details = Pick<StageInboxDeliveriesInput['source'], 'commentId' | 'status'>;

/** Maps a Task fact's declared audience to redacted inbox authorization candidates. */
@Injectable()
export class TaskInboxEventsHandler implements OnApplicationBootstrap {
  // #region Constructor
  /** Binds the broker consumers and both sides of the inbox authorization transaction. */
  public constructor(
    private readonly consumers: EventConsumers,
    private readonly stageDeliveries: StageInboxDeliveries,
    private readonly acceptAuthorization: AcceptInboxDeliveryAuthorization,
  ) {}
  // #endregion

  // #region Methods
  /** Registers the decision durable before any source can start requesting authorization. */
  public async onApplicationBootstrap(): Promise<void> {
    await this.subscribe(
      'inbox-task-delivery-authorized',
      TASK_NOTIFICATION_DELIVERY_AUTHORIZED_V1,
      (decision) => this.acceptDecision(decision),
      'all',
    );
    await this.subscribe('inbox-task-assigned', TASK_ASSIGNED_V1, (fact) =>
      this.stage(fact, [{ kind: 'assignment', recipientIds: [fact.assigneeId] }]),
    );
    await this.subscribe('inbox-task-status-changed', TASK_STATUS_CHANGED_V1, (fact) =>
      this.stage(fact, [{ kind: 'status-change', recipientIds: fact.watcherIds ?? [] }], {
        status: fact.status,
      }),
    );
    await this.subscribe('inbox-comment-created', COMMENT_CREATED_V1, (fact) =>
      this.stage(
        fact,
        [
          { kind: 'mention', recipientIds: fact.mentionedUserIds },
          {
            kind: 'comment',
            recipientIds: fact.replyToUserId === undefined ? [] : [fact.replyToUserId],
          },
          { kind: 'comment', recipientIds: fact.watcherIds },
        ],
        { commentId: fact.commentId },
      ),
    );
    await this.subscribe('inbox-comment-updated', COMMENT_UPDATED_V1, (fact) =>
      this.stage(fact, [{ kind: 'mention', recipientIds: fact.addedMentionUserIds }], {
        commentId: fact.commentId,
      }),
    );
    await this.subscribe(
      'inbox-description-mentions-changed',
      TASK_DESCRIPTION_MENTIONS_CHANGED_V1,
      (fact) => this.stage(fact, [{ kind: 'mention', recipientIds: fact.addedMentionUserIds }]),
    );
    await this.subscribe('inbox-approval-requested', APPROVAL_REQUESTED_V1, (fact) =>
      this.stage(fact, [{ kind: 'approval', recipientIds: fact.reviewerUserIds }]),
    );
    await this.subscribe('inbox-approval-decided', APPROVAL_DECIDED_V1, (fact) =>
      this.stage(fact, [{ kind: 'approval', recipientIds: [fact.requesterUserId] }], {
        commentId: fact.commentId,
      }),
    );
    await this.subscribe('inbox-task-access-requested', TASK_ACCESS_REQUESTED_V1, (fact) =>
      this.stage(fact, [{ kind: 'access', recipientIds: [fact.spaceOwnerUserId] }]),
    );
    await this.subscribe(
      'inbox-task-access-approved',
      TASK_ACCESS_REQUEST_DECIDED_V1,
      async (fact) => {
        if (fact.decision === 'approved') {
          await this.stage(fact, [{ kind: 'access', recipientIds: [fact.requesterUserId] }]);
        }
      },
    );
  }

  /** Makes broker cancellation fail the transactional delivery before it is acknowledged. */
  private subscribe<TName extends keyof typeof eventSchemas>(
    handler: string,
    event: TName,
    execute: (payload: EventPayloadOf<typeof eventSchemas, TName>) => Promise<void>,
    deliverPolicy: 'new' | 'all' = 'new',
  ): Promise<void> {
    return this.consumers.subscribe({
      handler,
      schemas: eventSchemas,
      event,
      deliverPolicy,
      handle: async (payload, { signal }) => {
        signal.throwIfAborted();
        await execute(payload);
        signal.throwIfAborted();
      },
    });
  }

  /** Preserves the verified tenant and access selector while leaving display fields at Task. */
  private async stage(
    fact: TaskFact,
    audiences: Audiences,
    details: Partial<Details> = {},
  ): Promise<void> {
    const actorUserId = fact.actor.type === 'user' ? userIdSchema.parse(fact.actor.id) : null;
    await this.stageDeliveries.execute({
      source: {
        organizationId: fact.organizationId,
        sourceEventId: fact.id,
        actorUserId,
        taskKey: fact.key,
        commentId: details.commentId ?? null,
        status: details.status ?? null,
      },
      audiences,
      expiresAt: Date.now() + AUTHORIZATION_WINDOW_MS,
    });
  }

  /** Accepts decisions only from the Task system actor on its broker subject. */
  private async acceptDecision(decision: TaskNotificationDeliveryAuthorizedV1): Promise<void> {
    if (decision.actor.type !== 'system' || decision.actor.id !== 'task-service') return;
    await this.acceptAuthorization.execute({
      organizationId: decision.organizationId,
      attemptId: decision.authorizationRequestId,
      decision: decision.decision,
      decidedAt: Date.parse(decision.occurredAt),
      validUntil: Date.parse(decision.validUntil),
    });
  }
  // #endregion
}
