import {
  TASK_NOTIFICATION_DELIVERY_AUTHORIZED_V1,
  eventSchemas,
} from '@cadenway/contracts/events/task-service';
import { EventConsumers } from '@cadenway/nest-messaging';
import { Injectable, type OnApplicationBootstrap } from '@nestjs/common';

import { AcceptActivityAuthorization } from '../../../../application/use-cases/commands/digest/accept-activity-authorization/accept-activity-authorization.use-case.js';

/** Handles activity decisions on a durable independent of older Inbox consumers. */
@Injectable()
export class ActivityAuthorizationHandler implements OnApplicationBootstrap {
  // #region Constructor
  /** Binds the installed Task event schema and the activity-only transition. */
  public constructor(
    private readonly consumers: EventConsumers,
    private readonly authorization: AcceptActivityAuthorization,
    private readonly enabled: boolean,
  ) {}
  // #endregion

  // #region Methods
  /** Replays retained facts so a decision cannot be lost during rolling startup. */
  public onApplicationBootstrap(): Promise<void> {
    if (!this.enabled) return Promise.resolve();
    return this.consumers.subscribe({
      handler: 'activity-task-delivery-authorized',
      schemas: eventSchemas,
      event: TASK_NOTIFICATION_DELIVERY_AUTHORIZED_V1,
      deliverPolicy: 'all',
      handle: async (decision, { signal }) => {
        signal.throwIfAborted();
        if (decision.actor.type !== 'system' || decision.actor.id !== 'task-service') return;
        await this.authorization.execute({
          organizationId: decision.organizationId,
          attemptId: decision.authorizationRequestId,
          decision: decision.decision,
          decidedAt: Date.parse(decision.occurredAt),
          validUntil: Date.parse(decision.validUntil),
        });
        signal.throwIfAborted();
      },
    });
  }
  // #endregion
}
