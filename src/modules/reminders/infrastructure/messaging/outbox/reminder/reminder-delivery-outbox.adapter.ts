import {
  NOTIFICATION_DELIVERY_AUTHORIZATION_REQUESTED_V1,
  REMINDER_DUE_V1,
  eventSchemas,
} from '@cadenway/contracts/events/notification-service';
import type { TransactionScope } from '@cadenway/nest-common/database';
import { OutboxWriter } from '@cadenway/nest-messaging/outbox';
import { Injectable } from '@nestjs/common';

import type { ReminderAuthorizationAttempt } from '../../../../application/models/reminder/reminder-authorization-attempt.model.js';
import type { ReminderDue } from '../../../../domain/events/reminder/reminder-due.event.js';

const actor = { type: 'system', id: 'notification-service' } as const;

/** Records a reminder's visibility request and eventual due fact through the transactional outbox. */
@Injectable()
export class ReminderDeliveryOutbox {
  // #region Constructor
  /** Binds the kit writer that validates and appends facts in an existing transaction. */
  public constructor(private readonly writer: OutboxWriter) {}
  // #endregion

  // #region Methods
  /** Requests Task access to one recipient's exact task, using only the opaque correlation. */
  public async recordRequest(
    scope: TransactionScope,
    attempt: ReminderAuthorizationAttempt,
  ): Promise<void> {
    await this.writer.append(
      scope,
      eventSchemas,
      NOTIFICATION_DELIVERY_AUTHORIZATION_REQUESTED_V1,
      {
        organizationId: attempt.organizationId,
        actor,
        version: 1,
        authorizationRequestId: attempt.id,
        recipientId: attempt.userId,
        subject: { kind: 'task-id', taskId: attempt.taskId },
        expiresAt: new Date(attempt.expiresAt).toISOString(),
      },
    );
  }

  /** Appends one due fact with the version produced by the fired reminder's transaction. */
  public async recordDue(scope: TransactionScope, fact: ReminderDue): Promise<void> {
    await this.writer.append(scope, eventSchemas, REMINDER_DUE_V1, {
      organizationId: fact.organizationId,
      actor,
      version: fact.version,
      reminderId: fact.reminderId,
      userId: fact.userId,
      taskId: fact.taskId,
    });
  }
  // #endregion
}
