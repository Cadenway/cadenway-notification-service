import {
  NOTIFICATION_DELIVERY_AUTHORIZATION_REQUESTED_V1,
  REMINDER_DUE_V1,
  eventSchemas,
} from '@cadenway/contracts/events/notification-service';
import type { TransactionScope } from '@cadenway/nest-common/database';
import type { OutboxWriter } from '@cadenway/nest-messaging/outbox';
import { describe, expect, it, vi } from 'vitest';

import type { ReminderAuthorizationAttempt } from '../../../../application/models/reminder/reminder-authorization-attempt.model.js';
import { ReminderDeliveryOutbox } from './reminder-delivery-outbox.adapter.js';

const ATTEMPT: ReminderAuthorizationAttempt = {
  id: '019a7005-6f7a-7b8c-9d0e-1f2a3b4c5d12',
  organizationId: '019a5f3c-8d2e-7c4a-9b1f-3e5d7a9c1b2f',
  reminderId: '019a7005-6f7a-7b8c-9d0e-1f2a3b4c5d13',
  taskId: '019a7005-6f7a-7b8c-9d0e-1f2a3b4c5d11',
  userId: '019a5f3c-9e1f-7b2a-8c3d-4e5f6a7b8c31',
  reminderVersion: 7,
  scheduleVersion: 3,
  expiresAt: Date.parse('2026-11-08T09:00:30.000Z'),
  status: 'pending',
};
const ENVELOPE = {
  id: '019a7005-6f7a-7b8c-9d0e-1f2a3b4c5d14',
  occurredAt: '2026-11-08T09:00:00.000Z',
};

/** Captures the generated event and the transaction in which the kit would write it. */
function harness() {
  const append = vi.fn<OutboxWriter['append']>().mockResolvedValue(ENVELOPE);
  const scope = { organizationId: ATTEMPT.organizationId } as TransactionScope;
  return {
    append,
    scope,
    outbox: new ReminderDeliveryOutbox({ append } as unknown as OutboxWriter),
  };
}

describe('ReminderDeliveryOutbox', () => {
  it('publishes an opaque attempt, intended account and stable Task UUID in the request', async () => {
    const { append, scope, outbox } = harness();
    await outbox.recordRequest(scope, ATTEMPT);
    expect(append).toHaveBeenCalledTimes(1);
    const [activeScope, schemas, name, data] = append.mock.calls[0] ?? [];
    expect(activeScope).toBe(scope);
    expect(schemas).toBe(eventSchemas);
    expect(name).toBe(NOTIFICATION_DELIVERY_AUTHORIZATION_REQUESTED_V1);
    expect(
      eventSchemas[NOTIFICATION_DELIVERY_AUTHORIZATION_REQUESTED_V1].parse({
        ...data,
        ...ENVELOPE,
      }),
    ).toEqual({
      ...ENVELOPE,
      organizationId: ATTEMPT.organizationId,
      actor: { type: 'system', id: 'notification-service' },
      version: 1,
      authorizationRequestId: ATTEMPT.id,
      recipientId: ATTEMPT.userId,
      subject: { kind: 'task-id', taskId: ATTEMPT.taskId },
      expiresAt: '2026-11-08T09:00:30.000Z',
    });
  });

  it('publishes the fired reminder version and only recipient and resource identifiers', async () => {
    const { append, scope, outbox } = harness();
    await outbox.recordDue(scope, {
      organizationId: ATTEMPT.organizationId,
      reminderId: ATTEMPT.reminderId,
      userId: ATTEMPT.userId,
      taskId: ATTEMPT.taskId,
      version: 8,
      remindAt: Date.parse('2026-11-08T08:00:00.000Z'),
      firedAt: Date.parse(ENVELOPE.occurredAt),
    });
    expect(append).toHaveBeenCalledTimes(1);
    const [activeScope, schemas, name, data] = append.mock.calls[0] ?? [];
    expect(activeScope).toBe(scope);
    expect(schemas).toBe(eventSchemas);
    expect(name).toBe(REMINDER_DUE_V1);
    expect(eventSchemas[REMINDER_DUE_V1].parse({ ...data, ...ENVELOPE })).toEqual({
      ...ENVELOPE,
      organizationId: ATTEMPT.organizationId,
      actor: { type: 'system', id: 'notification-service' },
      version: 8,
      reminderId: ATTEMPT.reminderId,
      userId: ATTEMPT.userId,
      taskId: ATTEMPT.taskId,
    });
  });
});
