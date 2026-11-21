import type { Job, JobsService } from '@cadenway/nest-jobs';
import { describe, expect, it, vi } from 'vitest';

import { RecoverContactSubmissionsHandler } from './recover-contact-submissions.handler.js';

const queue = 'email.recover-site-contact';
const cron = '*/15 * * * *';

function job(overrides: Partial<Job> = {}): Job {
  return {
    id: '01938f6e-0000-7000-8000-000000000002',
    queue,
    payload: null,
    organizationId: null,
    attempt: 1,
    signal: new AbortController().signal,
    ...overrides,
  };
}

function setup() {
  const registrations: string[] = [];
  const schedule = vi.fn<JobsService['schedule']>().mockResolvedValue(undefined);
  const jobs: Pick<JobsService, 'work' | 'schedule'> = {
    schedule,
    work: (name) => {
      registrations.push(name);
      return Promise.resolve();
    },
  };
  const execute = vi.fn<() => Promise<void>>().mockResolvedValue(undefined);
  const handler = new RecoverContactSubmissionsHandler(jobs, { execute }, queue, cron);
  return { registrations, schedule, execute, handler };
}

describe('Contact recovery jobs', () => {
  it('registers a system schedule without a payload and works the provisioned queue', async () => {
    const { registrations, schedule, handler } = setup();
    await handler.onApplicationBootstrap();

    expect(schedule).toHaveBeenCalledExactlyOnceWith(queue, cron, { timeZone: 'UTC' });
    expect(registrations).toEqual([queue]);
  });

  it('validates the system scope and empty scheduled shape', async () => {
    const { execute, handler } = setup();
    await expect(
      handler.handle(job({ organizationId: '01938f6e-0000-7000-8000-000000000001' })),
    ).rejects.toThrow('Invalid site contact recovery job.');
    await expect(handler.handle(job({ payload: {} }))).rejects.toThrow(
      'Invalid site contact recovery job.',
    );
    expect(execute).not.toHaveBeenCalled();

    await handler.handle(job());
    expect(execute).toHaveBeenCalledExactlyOnceWith();
  });

  it('retries a failed sweep without forwarding database exception data', async () => {
    const { execute, handler } = setup();
    execute.mockRejectedValueOnce(new Error('detail kept in persistence'));

    await expect(handler.handle(job())).rejects.toThrow(/^Site contact recovery failed\.$/u);
  });
});
