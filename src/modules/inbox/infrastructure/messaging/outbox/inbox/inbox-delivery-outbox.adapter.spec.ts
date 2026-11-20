import {
  NOTIFICATION_CREATED_V1,
  NOTIFICATION_DELIVERY_AUTHORIZATION_REQUESTED_V1,
  eventSchemas,
} from '@cadenway/contracts/events/notification-service';
import type { TransactionScope } from '@cadenway/nest-common/database';
import type { OutboxWriter } from '@cadenway/nest-messaging/outbox';
import { describe, expect, it, vi } from 'vitest';

import type { InboxAuthorizationAttempt } from '../../../../application/models/inbox/inbox-authorization-attempt.model.js';
import { InboxDeliveryOutbox } from './inbox-delivery-outbox.adapter.js';

const ATTEMPT: InboxAuthorizationAttempt = {
  id: '019a7005-6f7a-7b8c-9d0e-1f2a3b4c5d12',
  outcome: 'pending',
  expiresAt: Date.parse('2026-11-08T09:00:30.000Z'),
  candidate: {
    organizationId: '019a5f3c-8d2e-7c4a-9b1f-3e5d7a9c1b2f',
    sourceEventId: '019a7005-6f7a-7b8c-9d0e-1f2a3b4c5d10',
    recipientId: '019a5f3c-9e1f-7b2a-8c3d-4e5f6a7b8c31',
    actorUserId: '019a5f3c-8d2e-7c4a-9b1f-3e5d7a9c1b30',
    kind: 'mention',
    taskKey: 'CAD-482',
    commentId: '019a7005-6f7a-7b8c-9d0e-1f2a3b4c5d11',
    status: null,
  },
};
const ENVELOPE = {
  id: '019a7005-6f7a-7b8c-9d0e-1f2a3b4c5d14',
  occurredAt: '2026-11-08T09:00:00.000Z',
};

/** Preserves the caller's transaction identity while validating captured contract data. */
function harness() {
  const append = vi.fn<OutboxWriter['append']>().mockResolvedValue(ENVELOPE);
  const writer = { append } as unknown as OutboxWriter;
  const scope = { organizationId: ATTEMPT.candidate.organizationId } as TransactionScope;
  return { append, outbox: new InboxDeliveryOutbox(writer), scope };
}

describe('InboxDeliveryOutbox', () => {
  it('appends only the immutable correlation, authorized recipient and task selector on a request', async () => {
    const { append, outbox, scope } = harness();
    await outbox.recordRequest(scope, ATTEMPT);
    expect(append).toHaveBeenCalledTimes(1);
    const [activeScope, schemas, name, data] = append.mock.calls[0] ?? [];
    expect(activeScope).toBe(scope);
    expect(schemas).toBe(eventSchemas);
    expect(name).toBe(NOTIFICATION_DELIVERY_AUTHORIZATION_REQUESTED_V1);
    const request = eventSchemas[NOTIFICATION_DELIVERY_AUTHORIZATION_REQUESTED_V1].parse({
      ...data,
      ...ENVELOPE,
    });
    expect(request).toEqual({
      ...ENVELOPE,
      organizationId: ATTEMPT.candidate.organizationId,
      actor: { type: 'system', id: 'notification-service' },
      version: 1,
      authorizationRequestId: ATTEMPT.id,
      recipientId: ATTEMPT.candidate.recipientId,
      subject: { kind: 'task-key', taskKey: ATTEMPT.candidate.taskKey },
      expiresAt: '2026-11-08T09:00:30.000Z',
    });
  });

  it('appends a recipient-only creation fact with the checked selector in the same transaction', async () => {
    const { append, outbox, scope } = harness();
    const fact = {
      organizationId: ATTEMPT.candidate.organizationId,
      recipientId: ATTEMPT.candidate.recipientId,
      notificationId: '019a7005-6f7a-7b8c-9d0e-1f2a3b4c5d13',
      createdAt: Date.parse('2026-11-08T09:00:00.000Z'),
    };
    const subject = { kind: 'task-key', taskKey: ATTEMPT.candidate.taskKey } as const;
    await outbox.recordCreated(scope, fact, subject);
    expect(append).toHaveBeenCalledTimes(1);
    const [activeScope, schemas, name, data] = append.mock.calls[0] ?? [];
    expect(activeScope).toBe(scope);
    expect(schemas).toBe(eventSchemas);
    expect(name).toBe(NOTIFICATION_CREATED_V1);
    const created = eventSchemas[NOTIFICATION_CREATED_V1].parse({ ...data, ...ENVELOPE });
    expect(created).toEqual({
      ...ENVELOPE,
      ...fact,
      actor: { type: 'system', id: 'notification-service' },
      version: 1,
      subject,
      createdAt: ENVELOPE.occurredAt,
    });
  });
});
