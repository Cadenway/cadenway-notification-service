import { getOrganizationContext } from '@cadenway/nest-common';
import type { Job, JobHandler, JobsService } from '@cadenway/nest-jobs';
import { describe, expect, it, vi } from 'vitest';

import type { RetryInboxDeliveryAuthorization } from '../../../../application/use-cases/commands/inbox/retry-inbox-delivery-authorization/retry-inbox-delivery-authorization.use-case.js';
import { RetryInboxDeliveryAuthorizationHandler } from './retry-inbox-delivery-authorization.handler.js';

const ORGANIZATION_ID = '019a5f3c-8d2e-7c4a-9b1f-3e5d7a9c1b2f';
const ATTEMPT_ID = '019a7005-6f7a-7b8c-9d0e-1f2a3b4c5d12';
const QUEUE = 'inbox.retry-authorization';

/** Builds an envelope with private tenant metadata. */
function job(overrides: Partial<Job> = {}): Job {
  return {
    id: '019a7005-6f7a-7b8c-9d0e-1f2a3b4c5d13',
    queue: QUEUE,
    payload: { attemptId: ATTEMPT_ID, retryCount: 1 },
    organizationId: ORGANIZATION_ID,
    attempt: 1,
    signal: new AbortController().signal,
    ...overrides,
  };
}

/** Provides the queue registration and application entry point without creating a worker. */
function harness() {
  const execute = vi.fn<RetryInboxDeliveryAuthorization['execute']>().mockResolvedValue(true);
  const work = vi.fn<JobsService['work']>().mockResolvedValue(undefined);
  return {
    execute,
    work,
    handler: new RetryInboxDeliveryAuthorizationHandler({ work }, { execute }, QUEUE),
  };
}

describe('RetryInboxDeliveryAuthorizationHandler', () => {
  it('starts the provisioned queue and uses the envelope tenant and correlation', async () => {
    const { execute, handler, work } = harness();
    execute.mockImplementation(() => {
      expect(getOrganizationContext()).toMatchObject({
        organizationId: ORGANIZATION_ID,
        actor: { type: 'system', id: null },
      });
      return Promise.resolve(true);
    });

    await handler.onApplicationBootstrap();
    expect(work).toHaveBeenCalledOnce();
    const registration: [string, JobHandler, ...unknown[]] | undefined = work.mock.calls[0];
    expect(registration?.[0]).toBe(QUEUE);
    await registration?.[1](job());

    expect(execute).toHaveBeenCalledExactlyOnceWith({
      organizationId: ORGANIZATION_ID,
      attemptId: ATTEMPT_ID,
      retryCount: 1,
    });
  });

  it('rejects malformed jobs and a tenant supplied through the payload', async () => {
    const { execute, handler } = harness();

    await expect(handler.handle(job({ organizationId: null }))).rejects.toThrow();
    await expect(
      handler.handle(job({ payload: { attemptId: ATTEMPT_ID, retryCount: 11 } })),
    ).rejects.toThrow();
    await expect(
      handler.handle(
        job({ payload: { attemptId: ATTEMPT_ID, retryCount: 1, organizationId: ORGANIZATION_ID } }),
      ),
    ).rejects.toThrow();
    expect(execute).not.toHaveBeenCalled();
  });

  it('leaves an aborted job for the queue without entering the transaction', async () => {
    const { execute, handler } = harness();

    await expect(handler.handle(job({ signal: AbortSignal.abort() }))).rejects.toThrow();
    expect(execute).not.toHaveBeenCalled();
  });
});
