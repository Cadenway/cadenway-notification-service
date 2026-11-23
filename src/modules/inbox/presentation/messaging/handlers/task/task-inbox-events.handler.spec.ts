import type { eventSchemas } from '@cadenway/contracts/events/task-service';
import type { EventConsumers, EventContext, EventSubscription } from '@cadenway/nest-messaging';
import { describe, expect, it, vi } from 'vitest';

import type { InboxActivityDelivery } from '../../../../application/ports/outbound/activity-digests/inbox/inbox-activity-delivery.port.js';
import type { AcceptInboxDeliveryAuthorization } from '../../../../application/use-cases/commands/inbox/accept-inbox-delivery-authorization/accept-inbox-delivery-authorization.use-case.js';
import type { StageInboxDeliveries } from '../../../../application/use-cases/commands/inbox/stage-inbox-deliveries/stage-inbox-deliveries.use-case.js';
import { StageTaskNotificationFact } from '../../../../application/use-cases/commands/inbox/stage-task-notification-fact/stage-task-notification-fact.use-case.js';
import { TaskInboxEventsHandler } from './task-inbox-events.handler.js';

type EventName = keyof typeof eventSchemas;
type Subscription = EventSubscription<typeof eventSchemas, EventName>;

const LAURE = '019a5f3c-8d2e-7c4a-9b1f-3e5d7a9c1b30';
const CAMILLE = '019a5f3c-9e1f-7b2a-8c3d-4e5f6a7b8c31';
const LEA = '019a5f3c-9e1f-7b2a-8c3d-4e5f6a7b8c32';
const LINK_ID = '019a7005-6f7a-7b8c-9d0e-1f2a3b4c5d11';
const ENVELOPE = {
  id: '019a7005-6f7a-7b8c-9d0e-1f2a3b4c5d10',
  occurredAt: '2026-11-08T09:00:00.000Z',
  organizationId: '019a5f3c-8d2e-7c4a-9b1f-3e5d7a9c1b2f',
  actor: { type: 'user', id: LAURE },
  version: 8,
};
const LOCATION = {
  key: 'CAD-482',
  spaceId: '019a7002-3c4d-7e5f-8a6b-7c8d9e0f1a23',
  listId: '019a7002-3c4d-7e5f-8a6b-7c8d9e0f1a24',
};
const TASK = {
  ...LOCATION,
  parentKey: null,
  name: 'Private task title',
  status: 'progress',
  cancelReason: null,
  priority: 'moyenne',
  assigneeIds: [CAMILLE, LEA],
  dueDate: null,
  startDate: null,
  estimateMinutes: null,
  labels: [],
  completedAt: null,
};

/** Registers the real adapters and dispatches their published schema output without a broker. */
async function harness() {
  const subscriptions: Subscription[] = [];
  const consumers = {
    subscribe: (value: Subscription): Promise<void> => {
      subscriptions.push(value);
      return Promise.resolve();
    },
  } as unknown as EventConsumers;
  const stage = vi.fn<StageInboxDeliveries['execute']>().mockResolvedValue(0);
  const enqueueActivity = vi.fn<InboxActivityDelivery['enqueue']>().mockResolvedValue();
  const accept = vi.fn<AcceptInboxDeliveryAuthorization['execute']>().mockResolvedValue(false);
  const handler = new TaskInboxEventsHandler(
    consumers,
    new StageTaskNotificationFact({ execute: stage }, { enqueue: enqueueActivity }),
    { execute: accept } as unknown as AcceptInboxDeliveryAuthorization,
  );
  await handler.onApplicationBootstrap();

  /** Supplies the broker's context after the selected contract has validated the payload. */
  async function deliver(
    event: EventName,
    data: unknown,
    signal: AbortSignal = new AbortController().signal,
  ): Promise<void> {
    const subscription = subscriptions.find((candidate) => candidate.event === event);
    if (subscription === undefined) throw new Error(`Missing Task subscription for ${event}.`);
    const context: EventContext = {
      deliveryCount: 1,
      streamSequence: 1,
      redelivered: false,
      claimVersion: () => Promise.reject(new Error('These facts are deduplicated by event ID.')),
      signal,
    };
    await subscription.handle(subscription.schemas[event].parse(data), context);
  }

  return { subscriptions, deliver, stage, enqueueActivity, accept };
}

describe('TaskInboxEventsHandler', () => {
  it('registers the decision durable first and subscribes each eligible task fact once', async () => {
    const { subscriptions } = await harness();
    expect(subscriptions.map(({ event, deliverPolicy }) => [event, deliverPolicy])).toEqual([
      ['task.notification-delivery-authorized.v1', 'all'],
      ['task.assigned.v1', 'new'],
      ['task.status-changed.v1', 'new'],
      ['comment.created.v1', 'new'],
      ['comment.updated.v1', 'new'],
      ['task.description-mentions-changed.v1', 'new'],
      ['approval.requested.v1', 'new'],
      ['approval.decided.v1', 'new'],
      ['task.access-requested.v1', 'new'],
      ['task.access-request-decided.v1', 'new'],
    ]);
    expect(new Set(subscriptions.map(({ handler }) => handler)).size).toBe(subscriptions.length);
  });

  it('only stages the new assignee and leaves the task title out of the candidate', async () => {
    const { deliver, stage, enqueueActivity } = await harness();
    await deliver('task.assigned.v1', {
      ...ENVELOPE,
      ...TASK,
      assigneeId: CAMILLE,
    });
    expect(stage).toHaveBeenCalledTimes(1);
    const [input] = stage.mock.calls[0] ?? [];
    expect(input?.audiences).toEqual([{ kind: 'assignment', recipientIds: [CAMILLE] }]);
    expect(input?.source).toEqual({
      organizationId: ENVELOPE.organizationId,
      sourceEventId: ENVELOPE.id,
      actorUserId: LAURE,
      taskKey: LOCATION.key,
      commentId: null,
      status: null,
    });
    expect(input?.expiresAt).toBeGreaterThan(Date.now());
    expect(enqueueActivity).toHaveBeenCalledExactlyOnceWith({
      source: input?.source,
      audiences: input?.audiences,
      actor: ENVELOPE.actor,
      occurredAt: ENVELOPE.occurredAt,
      version: ENVELOPE.version,
    });
  });

  it('uses only the optional committed watcher audience for a status change', async () => {
    const { deliver, stage } = await harness();
    const fact = {
      ...ENVELOPE,
      ...TASK,
      previousStatus: 'todo',
      cancelNote: 'Private status note',
    };
    await deliver('task.status-changed.v1', fact);
    await deliver('task.status-changed.v1', {
      ...fact,
      actor: { type: 'automation', id: 'rule-status-change' },
      watcherIds: [LEA],
    });
    const [legacy, current] = stage.mock.calls.map(([input]) => input);

    expect(legacy?.audiences).toEqual([{ kind: 'status-change', recipientIds: [] }]);
    expect(current?.audiences).toEqual([{ kind: 'status-change', recipientIds: [LEA] }]);
    expect(current?.source).toEqual({
      organizationId: ENVELOPE.organizationId,
      sourceEventId: ENVELOPE.id,
      actorUserId: null,
      taskKey: LOCATION.key,
      commentId: null,
      status: 'progress',
    });
  });

  it('ranks new comment mentions before replies and watchers and only includes added mentions on edit', async () => {
    const { deliver, stage } = await harness();
    const comment = { ...ENVELOPE, ...LOCATION, commentId: LINK_ID, commentVersion: 2 };
    await deliver('comment.created.v1', {
      ...comment,
      mentionedUserIds: [CAMILLE],
      replyToUserId: CAMILLE,
      replyToCommentId: LINK_ID,
      watcherIds: [CAMILLE, LEA],
    });
    await deliver('comment.updated.v1', {
      ...comment,
      addedMentionUserIds: [LEA],
      removedMentionUserIds: [CAMILLE],
    });
    await deliver('task.description-mentions-changed.v1', {
      ...ENVELOPE,
      ...LOCATION,
      addedMentionUserIds: [CAMILLE],
      removedMentionUserIds: [LEA],
    });
    const [created, updated, description] = stage.mock.calls.map(([input]) => input);

    expect(created?.audiences).toEqual([
      { kind: 'mention', recipientIds: [CAMILLE] },
      { kind: 'comment', recipientIds: [CAMILLE] },
      { kind: 'comment', recipientIds: [CAMILLE, LEA] },
    ]);
    expect(created?.source.commentId).toBe(LINK_ID);
    expect(updated?.audiences).toEqual([{ kind: 'mention', recipientIds: [LEA] }]);
    expect(updated?.source.commentId).toBe(LINK_ID);
    expect(description?.audiences).toEqual([{ kind: 'mention', recipientIds: [CAMILLE] }]);
    expect(description?.source.commentId).toBeNull();
  });

  it('stages designated reviewers and the requester for their respective approval facts', async () => {
    const { deliver, stage, enqueueActivity } = await harness();
    const approval = { ...ENVELOPE, ...LOCATION, roundId: LINK_ID };
    await deliver('approval.requested.v1', { ...approval, reviewerUserIds: [CAMILLE] });
    await deliver('approval.decided.v1', {
      ...approval,
      requesterUserId: LEA,
      decision: 'changes-requested',
      commentId: LINK_ID,
    });
    const [requested, decided] = stage.mock.calls.map(([input]) => input);

    expect(requested?.audiences).toEqual([{ kind: 'approval', recipientIds: [CAMILLE] }]);
    expect(decided?.audiences).toEqual([{ kind: 'approval', recipientIds: [LEA] }]);
    expect(decided?.source.commentId).toBe(LINK_ID);
    expect(enqueueActivity).not.toHaveBeenCalled();
  });

  it('uses the exact task request recipients and withholds decisions without an approved link', async () => {
    const { deliver, stage } = await harness();
    const access = { ...ENVELOPE, ...LOCATION, accessRequestId: LINK_ID, requesterUserId: CAMILLE };
    await deliver('task.access-requested.v1', {
      ...access,
      version: 1,
      actor: { type: 'user', id: CAMILLE },
      name: 'Private task title',
      spaceName: 'Private space',
      listName: 'Private list',
      spaceOwnerUserId: LEA,
      message: 'Private request message',
    });
    await deliver('task.access-request-decided.v1', {
      ...access,
      version: 2,
      decision: 'approved',
      role: 'view',
    });
    await deliver('task.access-request-decided.v1', {
      ...access,
      version: 2,
      decision: 'refused',
      role: null,
    });
    const [requested, approved] = stage.mock.calls.map(([input]) => input);

    expect(stage).toHaveBeenCalledTimes(2);
    expect(requested?.audiences).toEqual([{ kind: 'access', recipientIds: [LEA] }]);
    expect(approved?.audiences).toEqual([{ kind: 'access', recipientIds: [CAMILLE] }]);
    expect(requested?.source).toEqual({
      organizationId: ENVELOPE.organizationId,
      sourceEventId: ENVELOPE.id,
      actorUserId: CAMILLE,
      taskKey: LOCATION.key,
      commentId: null,
      status: null,
    });
  });

  it('passes only a Task system decision to the inbox attempt and propagates cancellation', async () => {
    const { deliver, accept, enqueueActivity } = await harness();
    const decision = {
      ...ENVELOPE,
      version: 1,
      authorizationRequestId: LINK_ID,
      decision: 'permit',
      validUntil: '2026-11-08T09:00:15.000Z',
    };
    const fromTask = { ...decision, actor: { type: 'system', id: 'task-service' } };
    await deliver('task.notification-delivery-authorized.v1', decision);
    await deliver('task.notification-delivery-authorized.v1', {
      ...decision,
      actor: { type: 'system', id: 'search-service' },
    });
    await deliver('task.notification-delivery-authorized.v1', fromTask);
    expect(accept).toHaveBeenCalledExactlyOnceWith({
      organizationId: ENVELOPE.organizationId,
      attemptId: LINK_ID,
      decision: 'permit',
      decidedAt: Date.parse(ENVELOPE.occurredAt),
      validUntil: Date.parse(decision.validUntil),
    });
    const expired = new Error('Broker shutdown');
    await expect(
      deliver('task.notification-delivery-authorized.v1', fromTask, AbortSignal.abort(expired)),
    ).rejects.toBe(expired);
    expect(accept).toHaveBeenCalledTimes(1);
    expect(enqueueActivity).not.toHaveBeenCalled();
  });
});
