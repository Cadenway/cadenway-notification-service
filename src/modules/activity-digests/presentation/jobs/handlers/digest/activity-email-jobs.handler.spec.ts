import { getOrganizationContext } from '@cadenway/nest-common';
import type { Job, JobsService } from '@cadenway/nest-jobs';
import { describe, expect, it, vi } from 'vitest';

import type { RequestActivityAuthorization } from '../../../../application/use-cases/commands/digest/request-activity-authorization/request-activity-authorization.use-case.js';
import type { SendActivityEmail } from '../../../../application/use-cases/commands/digest/send-activity-email/send-activity-email.use-case.js';
import { ActivityEmailJobsHandler } from './activity-email-jobs.handler.js';

const userId = '019a7000-1a2b-7c3d-8e4f-5a6b7c8d9e11';
const occurrenceId = '019a7000-1a2b-7c3d-8e4f-5a6b7c8d9e12';
const tenantA = '019a7000-1a2b-7c3d-8e4f-5a6b7c8d9e13';
const tenantB = '019a7000-1a2b-7c3d-8e4f-5a6b7c8d9e14';
const now = Date.parse('2026-11-20T09:00:00Z');
const queues = { plan: 'activity.plan-email', send: 'activity.send-email' };

function harness(enabled = true) {
  const work = vi.fn<JobsService['work']>().mockResolvedValue(undefined);
  const plan = vi.fn().mockResolvedValue(1);
  const send = vi.fn<SendActivityEmail['execute']>().mockResolvedValue('pending');
  const request = vi.fn<RequestActivityAuthorization['execute']>().mockResolvedValue(true);
  const tenants = vi.fn().mockResolvedValue([tenantA, tenantB]);
  const jobs = new ActivityEmailJobsHandler(
    { work },
    { execute: plan },
    { execute: send },
    { execute: request },
    { execute: tenants },
    () => now,
    queues,
    enabled,
  );
  const input = { userId, occurrenceId, generation: 2 };
  const job: Job = {
    id: occurrenceId,
    queue: queues.send,
    payload: input,
    organizationId: null,
    attempt: 1,
    signal: new AbortController().signal,
  };
  return { jobs, work, plan, send, request, tenants, job, input };
}

describe('ActivityEmailJobsHandler', () => {
  it('registers both queues only when Identity signing is configured', async () => {
    const active = harness();
    await active.jobs.onApplicationBootstrap();
    expect(active.work.mock.calls.map(([queue]) => queue)).toEqual([queues.plan, queues.send]);
    const dormant = harness(false);
    await dormant.jobs.onApplicationBootstrap();
    expect(dormant.work).not.toHaveBeenCalled();
  });

  it('plans from the current time when the queued cutoff has elapsed', async () => {
    const { jobs, job, plan } = harness();
    await jobs.handlePlan({ ...job, payload: { userId, notBeforeMs: now - 5000 } });
    expect(plan).toHaveBeenCalledExactlyOnceWith({ userId, notBeforeMs: now });
  });

  it('requests fresh permits in their own trusted tenant scopes and retries the job while pending', async () => {
    const { jobs, job, request, send, input } = harness();
    const scopes: unknown[] = [];
    request.mockImplementation(() => {
      scopes.push(getOrganizationContext());
      return Promise.resolve(true);
    });
    await expect(jobs.handleDelivery(job)).rejects.toThrow(
      'Activity email authorization is pending.',
    );
    expect(send).toHaveBeenCalledExactlyOnceWith(input, job.signal);
    expect(request.mock.calls.map(([value]) => value)).toEqual(
      [tenantA, tenantB].map((organizationId) => ({
        ...input,
        organizationId,
        expiresAt: now + 30_000,
      })),
    );
    expect(scopes).toEqual(
      [tenantA, tenantB].map((organizationId) => ({
        organizationId,
        actor: { type: 'system', id: null },
        role: null,
        scopes: [],
      })),
    );
  });

  it('acknowledges an already removed generation and does not request authorizations for a sent one', async () => {
    const { jobs, job, send, request, tenants } = harness();
    tenants.mockResolvedValue([]);
    await jobs.handleDelivery(job);
    send.mockResolvedValueOnce('sent');
    await jobs.handleDelivery(job);
    expect(tenants).toHaveBeenCalledTimes(1);
    expect(request).not.toHaveBeenCalled();
  });

  it('refuses a tenant-tagged or cancelled account delivery before any read', async () => {
    const { jobs, job, send } = harness();
    await expect(jobs.handleDelivery({ ...job, organizationId: tenantA })).rejects.toThrow(
      'account-wide',
    );
    const cause = new Error('worker stopped');
    await expect(jobs.handleDelivery({ ...job, signal: AbortSignal.abort(cause) })).rejects.toBe(
      cause,
    );
    expect(send).not.toHaveBeenCalled();
  });
});
