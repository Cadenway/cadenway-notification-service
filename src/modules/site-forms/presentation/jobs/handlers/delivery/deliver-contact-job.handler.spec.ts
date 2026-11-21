import type { Job, JobsService } from '@cadenway/nest-jobs';
import { describe, expect, it, vi } from 'vitest';

import { DeliverContactJobHandler } from './deliver-contact-job.handler.js';

const submissionId = '01938f6e-0000-7000-8000-000000000001';
const queue = 'email.send-site-contact';

function job(payload: unknown, attempt = 1): Job {
  return {
    id: '01938f6e-0000-7000-8000-000000000002',
    queue,
    payload,
    organizationId: null,
    attempt,
    signal: new AbortController().signal,
  };
}

function setup() {
  const registrations: string[] = [];
  const jobs: Pick<JobsService, 'work'> = {
    work: (name) => {
      registrations.push(name);
      return Promise.resolve();
    },
  };
  const execute = vi.fn().mockResolvedValue(undefined);
  const handler = new DeliverContactJobHandler(jobs, { execute }, queue, 5);
  return { registrations, execute, handler };
}

describe('Contact delivery jobs', () => {
  it('registers the configured contact queue', async () => {
    const { registrations, handler } = setup();

    await handler.onApplicationBootstrap();

    expect(registrations).toEqual([queue]);
  });

  it('passes the original signal and identifies the final attempt', async () => {
    const { execute, handler } = setup();
    const first = job({ submissionId });
    const last = job({ submissionId }, 5);

    await handler.handle(first);
    await handler.handle(last);

    expect(execute).toHaveBeenNthCalledWith(1, {
      submissionId,
      signal: first.signal,
      lastAttempt: false,
    });
    expect(execute).toHaveBeenNthCalledWith(2, {
      submissionId,
      signal: last.signal,
      lastAttempt: true,
    });
  });

  it('rejects invalid or additional payload fields and tenant-scoped work', async () => {
    const { execute, handler } = setup();
    const tenantJob = { ...job({ submissionId }), organizationId: submissionId };

    await expect(handler.handle(job({ submissionId: 'CAD-482' }))).rejects.toThrow();
    await expect(handler.handle(job({ submissionId, message: 'extra' }))).rejects.toThrow();
    await expect(handler.handle(tenantJob)).rejects.toThrow();
    expect(execute).not.toHaveBeenCalled();
  });
});
