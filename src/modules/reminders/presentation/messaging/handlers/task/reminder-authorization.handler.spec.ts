import {
  TASK_NOTIFICATION_DELIVERY_AUTHORIZED_V1,
  eventSchemas,
} from '@cadenway/contracts/events/task-service';
import type { EventConsumers, EventContext, EventSubscription } from '@cadenway/nest-messaging';
import { describe, expect, it, vi } from 'vitest';

import type { AcceptReminderAuthorization } from '../../../../application/use-cases/commands/reminder/accept-reminder-authorization/accept-reminder-authorization.use-case.js';
import { ReminderAuthorizationHandler } from './reminder-authorization.handler.js';

type Subscription = EventSubscription<
  typeof eventSchemas,
  typeof TASK_NOTIFICATION_DELIVERY_AUTHORIZED_V1
>;

const DECISION = {
  id: '019a7005-6f7a-7b8c-9d0e-1f2a3b4c5d14',
  occurredAt: '2026-11-08T09:00:00.000Z',
  organizationId: '019a5f3c-8d2e-7c4a-9b1f-3e5d7a9c1b2f',
  authorizationRequestId: '019a7005-6f7a-7b8c-9d0e-1f2a3b4c5d12',
  actor: { type: 'system', id: 'task-service' },
  version: 1,
  decision: 'permit',
  validUntil: '2026-11-08T09:00:15.000Z',
};

/** Replays the generated schema's output with a scoped broker delivery context. */
async function harness() {
  const subscribe = vi
    .fn<(subscription: Subscription) => Promise<void>>()
    .mockResolvedValue(undefined);
  const accept = vi.fn<AcceptReminderAuthorization['execute']>().mockResolvedValue(false);
  const handler = new ReminderAuthorizationHandler(
    { subscribe } as unknown as EventConsumers,
    { execute: accept } as unknown as AcceptReminderAuthorization,
  );
  await handler.onApplicationBootstrap();
  const [subscription] = subscribe.mock.calls[0] ?? [];
  if (subscription === undefined) throw new Error('Reminder authorization did not subscribe.');
  const activeSubscription = subscription;

  /** Delivers the validated result with an optional shutdown signal. */
  async function deliver(
    data: unknown,
    signal: AbortSignal = new AbortController().signal,
  ): Promise<void> {
    const context: EventContext = {
      deliveryCount: 1,
      streamSequence: 1,
      redelivered: false,
      claimVersion: () => Promise.reject(new Error('A decision is deduplicated by event ID.')),
      signal,
    };
    const payload =
      activeSubscription.schemas[TASK_NOTIFICATION_DELIVERY_AUTHORIZED_V1].parse(data);
    await activeSubscription.handle(payload, context);
  }

  return { subscribe, subscription, accept, deliver };
}

describe('ReminderAuthorizationHandler', () => {
  it('delivers a retained Task result with its exact tenant, attempt and deadline', async () => {
    const { subscribe, subscription, accept, deliver } = await harness();
    expect(subscribe).toHaveBeenCalledTimes(1);
    expect(subscription).toMatchObject({
      handler: 'reminder-task-delivery-authorized',
      event: TASK_NOTIFICATION_DELIVERY_AUTHORIZED_V1,
      schemas: eventSchemas,
      deliverPolicy: 'all',
    });
    await deliver(DECISION);
    expect(accept).toHaveBeenCalledExactlyOnceWith({
      organizationId: DECISION.organizationId,
      attemptId: DECISION.authorizationRequestId,
      decision: DECISION.decision,
      decidedAt: Date.parse(DECISION.occurredAt),
      validUntil: Date.parse(DECISION.validUntil),
    });
  });

  it('withholds decisions from another actor and aborts a cancelled delivery', async () => {
    const { accept, deliver } = await harness();
    await deliver({ ...DECISION, actor: { type: 'system', id: 'search-service' } });
    await deliver({ ...DECISION, actor: { type: 'user', id: 'task-service' } });
    const stopped = new Error('Broker shutdown');
    await expect(deliver(DECISION, AbortSignal.abort(stopped))).rejects.toBe(stopped);
    expect(accept).not.toHaveBeenCalled();
  });
});
