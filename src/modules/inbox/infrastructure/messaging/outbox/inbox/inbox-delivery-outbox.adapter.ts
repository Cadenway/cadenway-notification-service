import {
  NOTIFICATION_CREATED_V1,
  NOTIFICATION_DELIVERY_AUTHORIZATION_REQUESTED_V1,
  eventSchemas,
} from '@cadenway/contracts/events/notification-service';
import type { NotificationCreatedV1 } from '@cadenway/contracts/events/notification-service';
import type { TransactionScope } from '@cadenway/nest-common/database';
import { OutboxWriter } from '@cadenway/nest-messaging/outbox';
import { Injectable } from '@nestjs/common';

import type { InboxAuthorizationAttempt } from '../../../../application/models/inbox/inbox-authorization-attempt.model.js';
import type { NotificationCreated } from '../../../../domain/events/inbox/notification-created.event.js';

const actor = { type: 'system', id: 'notification-service' } as const;

/** Appends redacted inbox facts in the transaction that stages or consumes a Task decision. */
@Injectable()
export class InboxDeliveryOutbox {
  // #region Constructor
  /** Binds the validated, transaction-aware kit writer. */
  public constructor(private readonly writer: OutboxWriter) {}
  // #endregion

  // #region Methods
  /** Requests one Task decision using only the attempt's recipient and visibility selector. */
  public async recordRequest(
    scope: TransactionScope,
    attempt: InboxAuthorizationAttempt,
  ): Promise<void> {
    const { organizationId, recipientId, taskKey } = attempt.candidate;
    await this.writer.append(
      scope,
      eventSchemas,
      NOTIFICATION_DELIVERY_AUTHORIZATION_REQUESTED_V1,
      {
        organizationId,
        actor,
        version: 1,
        authorizationRequestId: attempt.id,
        recipientId,
        subject: { kind: 'task-key', taskKey },
        expiresAt: new Date(attempt.expiresAt).toISOString(),
      },
    );
  }

  /** Announces creation for the recipient's inbox while display stays behind current authorization. */
  public async recordCreated(
    scope: TransactionScope,
    fact: NotificationCreated,
    subject: NotificationCreatedV1['subject'],
  ): Promise<void> {
    await this.writer.append(scope, eventSchemas, NOTIFICATION_CREATED_V1, {
      organizationId: fact.organizationId,
      actor,
      version: 1,
      notificationId: fact.notificationId,
      recipientId: fact.recipientId,
      subject,
      createdAt: new Date(fact.createdAt).toISOString(),
    });
  }
  // #endregion
}
