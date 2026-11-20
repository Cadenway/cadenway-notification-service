import {
  TASK_NOTIFICATION_DELIVERY_AUTHORIZED_V1,
  type eventSchemas,
} from '@cadenway/contracts/events/task-service';
import type { EventConsumers, EventContext, EventSubscription } from '@cadenway/nest-messaging';
import { describe, expect, it, vi } from 'vitest';

import { AcceptActivityAuthorization } from '../../../../application/use-cases/commands/digest/accept-activity-authorization/accept-activity-authorization.use-case.js';
import { ActivityAuthorizationHandler } from './activity-authorization.handler.js';

type Subscription = EventSubscription<
  typeof eventSchemas,
  typeof TASK_NOTIFICATION_DELIVERY_AUTHORIZED_V1
>;

const tenant = '019a7000-1a2b-7c3d-8e4f-5a6b7c8d9e11';
const attempt = '019a7000-1a2b-7c3d-8e4f-5a6b7c8d9e12';
const inboxAttempt = '019a7000-1a2b-7c3d-8e4f-5a6b7c8d9e13';
const envelope = {
  id: '019a7000-1a2b-7c3d-8e4f-5a6b7c8d9e14',
  organizationId: tenant,
  actor: { type: 'system', id: 'task-service' },
  version: 1,
  occurredAt: '2026-11-20T09:00:00Z',
  authorizationRequestId: attempt,
  decision: 'permit',
  validUntil: '2026-11-20T09:00:20Z',
};

function harness(enabled = true) {
  const subscribe = vi
    .fn<(subscription: Subscription) => Promise<void>>()
    .mockResolvedValue(undefined);
  const lockAttempt = vi
    .fn()
    .mockImplementation((organizationId: string, id: string) =>
      Promise.resolve(
        organizationId === tenant && id === attempt
          ? { id, organizationId, outcome: 'pending', expiresAt: Date.parse(envelope.validUntil) }
          : null,
      ),
    );
  const finishAttempt = vi.fn().mockResolvedValue(undefined);
  const store = {
    lockAttempt,
    finishAttempt,
    skipRecipient: vi.fn(),
    requestAuthorization: vi.fn(),
    leaseAuthorized: vi.fn(),
    finish: vi.fn(),
    release: vi.fn(),
  };
  const authorization = new AcceptActivityAuthorization(
    {
      runAccount: (_id, work) => work(store),
      runTenant: (_id, work) => work(store),
    },
    () => Date.parse('2026-11-20T09:00:02Z'),
  );
  const handler = new ActivityAuthorizationHandler(
    { subscribe } as unknown as EventConsumers,
    authorization,
    enabled,
  );
  const context: EventContext = {
    deliveryCount: 1,
    streamSequence: 1,
    redelivered: false,
    claimVersion: () => Promise.reject(new Error('Activity decisions deduplicate by correlation.')),
    signal: new AbortController().signal,
  };
  return { subscribe, lockAttempt, finishAttempt, handler, context };
}

describe('ActivityAuthorizationHandler', () => {
  it('skips the durable while Identity signing is dormant', async () => {
    const { handler, subscribe } = harness(false);
    await handler.onApplicationBootstrap();
    expect(subscribe).not.toHaveBeenCalled();
  });

  it('uses its dedicated Task durable and only settles its own correlation', async () => {
    const { handler, subscribe, lockAttempt, finishAttempt, context } = harness();
    await handler.onApplicationBootstrap();
    const subscription = subscribe.mock.calls[0]?.[0];
    if (subscription === undefined) throw new Error('The dedicated activity durable is missing.');
    expect(subscription).toMatchObject({
      handler: 'activity-task-delivery-authorized',
      event: TASK_NOTIFICATION_DELIVERY_AUTHORIZED_V1,
      deliverPolicy: 'all',
    });
    const schema = subscription.schemas[subscription.event];
    await subscription.handle(
      schema.parse({ ...envelope, actor: { type: 'system', id: 'other-service' } }),
      context,
    );
    expect(lockAttempt).not.toHaveBeenCalled();
    await subscription.handle(
      schema.parse({ ...envelope, authorizationRequestId: inboxAttempt }),
      context,
    );
    expect(finishAttempt).not.toHaveBeenCalled();
    await subscription.handle(schema.parse(envelope), context);
    expect(finishAttempt).toHaveBeenCalledExactlyOnceWith(
      tenant,
      attempt,
      'permitted',
      Date.parse(envelope.validUntil),
    );
  });
});
