import {
  NOTIFICATION_DELIVERY_AUTHORIZATION_REQUESTED_V1,
  eventSchemas,
} from '@cadenway/contracts/events/notification-service';
import { OutboxWriter } from '@cadenway/nest-messaging/outbox';
import { Injectable } from '@nestjs/common';

import type { ActivityDigestPersistenceBindings } from '../../../persistence/drizzle/transactions/digest/drizzle-activity-digest.unit-of-work.js';

/** Writes a Task authorization fact in the transaction that stores its correlation. */
@Injectable()
export class ActivityAuthorizationOutbox {
  // #region Constructor
  /** Binds the platform writer for installed AsyncAPI contracts. */
  public constructor(private readonly writer: OutboxWriter) {}
  // #endregion

  // #region Methods
  /** Carries only the recipient, resource selector and expiry required by Task. */
  public async append(
    ...[scope, request]: Parameters<ActivityDigestPersistenceBindings['writeAuthorization']>
  ): Promise<void> {
    await this.writer.append(
      scope,
      eventSchemas,
      NOTIFICATION_DELIVERY_AUTHORIZATION_REQUESTED_V1,
      {
        organizationId: request.organizationId,
        actor: { type: 'system', id: 'notification-service' },
        version: 1,
        authorizationRequestId: request.attemptId,
        recipientId: request.recipientId,
        subject: { kind: 'task-key', taskKey: request.taskKey },
        expiresAt: new Date(request.expiresAt).toISOString(),
      },
    );
  }
  // #endregion
}
