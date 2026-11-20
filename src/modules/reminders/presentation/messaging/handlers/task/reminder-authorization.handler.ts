import {
  TASK_NOTIFICATION_DELIVERY_AUTHORIZED_V1,
  eventSchemas,
} from '@cadenway/contracts/events/task-service';
import type { TaskNotificationDeliveryAuthorizedV1 } from '@cadenway/contracts/events/task-service';
import { EventConsumers } from '@cadenway/nest-messaging';
import { Injectable } from '@nestjs/common';
import type { OnApplicationBootstrap } from '@nestjs/common';

import { AcceptReminderAuthorization } from '../../../../application/use-cases/commands/reminder/accept-reminder-authorization/accept-reminder-authorization.use-case.js';

/** Routes opaque Task decisions to the reminder attempt transaction. */
@Injectable()
export class ReminderAuthorizationHandler implements OnApplicationBootstrap {
  // #region Constructor
  /** Binds the broker consumer and the reminder authorization operation. */
  public constructor(
    private readonly consumers: EventConsumers,
    private readonly acceptAuthorization: AcceptReminderAuthorization,
  ) {}
  // #endregion

  // #region Methods
  /** Registers the durable for both new and already staged reminder attempts. */
  public onApplicationBootstrap(): Promise<void> {
    return this.consumers.subscribe({
      handler: 'reminder-task-delivery-authorized',
      schemas: eventSchemas,
      event: TASK_NOTIFICATION_DELIVERY_AUTHORIZED_V1,
      deliverPolicy: 'all',
      handle: async (decision, { signal }) => {
        signal.throwIfAborted();
        await this.acceptDecision(decision);
        signal.throwIfAborted();
      },
    });
  }

  /** Accepts only decisions from the Task system actor on the authorized subject. */
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
