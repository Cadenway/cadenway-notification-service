import type { Job } from '@cadenway/nest-jobs';
import { describe, expect, it, vi } from 'vitest';

import { ActivityEmailSourceHandler } from './activity-email-source.handler.js';

const organizationId = '019a5f3c-8d2e-7c4a-9b1f-3e5d7a9c1b2f';
const sourceEventId = '019a7005-6f7a-7b8c-9d0e-1f2a3b4c5d10';
const recipientId = '019a7005-6f7a-7b8c-9d0e-1f2a3b4c5d11';
const queue = 'activity.stage-email';
const payload = {
  source: {
    organizationId,
    sourceEventId,
    actorUserId: null,
    taskKey: 'CAD-482',
    commentId: null,
    status: null,
  },
  audiences: [{ kind: 'assignment', recipientIds: [recipientId] }],
  actor: { type: 'system', id: 'task-service' },
  occurredAt: '2026-11-08T09:00:00.000Z',
  version: 3,
};

const job: Job = {
  id: '019a7005-6f7a-7b8c-9d0e-1f2a3b4c5d12',
  queue,
  organizationId,
  payload,
  attempt: 1,
  signal: new AbortController().signal,
};

describe('ActivityEmailSourceHandler', () => {
  it('retriggers a failed email intake and skips a replay after the receipt committed', async () => {
    const error = new Error('Preference store unavailable');
    const execute = vi.fn().mockRejectedValueOnce(error).mockResolvedValue(0);
    let recorded = false;
    const handler = new ActivityEmailSourceHandler(
      { work: vi.fn() },
      { execute },
      async (envelope, handle) => {
        expect(envelope.id).toBe(sourceEventId);
        if (recorded) return;
        await handle();
        recorded = true;
      },
      queue,
      true,
    );

    await expect(handler.handle(job)).rejects.toBe(error);
    await expect(handler.handle({ ...job, attempt: 2 })).resolves.toBeUndefined();
    await expect(handler.handle({ ...job, attempt: 3 })).resolves.toBeUndefined();
    expect(execute).toHaveBeenCalledTimes(2);
    expect(execute).toHaveBeenCalledWith({ source: payload.source, audiences: payload.audiences });
  });

  it('declines a handoff from another tenant before opening an intake transaction', async () => {
    const deduplicate = vi.fn();
    const handler = new ActivityEmailSourceHandler(
      { work: vi.fn() },
      { execute: vi.fn() },
      deduplicate,
      queue,
      true,
    );
    await expect(handler.handle({ ...job, organizationId: recipientId })).rejects.toThrow(
      'Activity email source job must match its Inbox tenant.',
    );
    expect(deduplicate).not.toHaveBeenCalled();
  });

  it('accepts the published Task actor shape for a system fact without an actor id', async () => {
    const execute = vi.fn().mockResolvedValue(0);
    const handler = new ActivityEmailSourceHandler(
      { work: vi.fn() },
      { execute },
      async (_envelope, handle) => handle(),
      queue,
      true,
    );
    const fact = { ...payload, actor: { type: 'system', id: '' } };

    await expect(handler.handle({ ...job, payload: fact })).resolves.toBeUndefined();
    expect(execute).toHaveBeenCalledExactlyOnceWith({
      source: payload.source,
      audiences: payload.audiences,
    });
  });
});
