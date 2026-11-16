import {
  EXPIRE_CODE_EMAILS_QUEUE,
  EXPIRE_CODE_EMAILS_CRON,
} from '../../../../../../config/job-queues.js';
import type { JobScheduleOptions, JobWorkerRegistry } from '@cadenway/nest-jobs/runtime';
import { Logger } from '@nestjs/common';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { ExpireCodeEmails } from '../../../../application/use-cases/commands/code-email/expire-code-emails/expire-code-emails.use-case.js';
import { ExpireCodeEmailsHandler } from './expire-code-emails.handler.js';
import { ExpireCodeEmailsScheduleHandler } from './expire-code-emails-schedule.handler.js';

describe('ExpireCodeEmailsHandler', () => {
  let schedules: { readonly queue: string; readonly cron: string; readonly timeZone: string }[];
  let workers: string[];
  let runs: number;
  let handler: ExpireCodeEmailsHandler;

  beforeAll(() => {
    // The handler logs what it settles; the console of the test run stays quiet.
    Logger.overrideLogger(false);
  });

  afterAll(() => {
    Logger.overrideLogger(['log', 'error', 'warn', 'debug', 'verbose', 'fatal']);
  });

  beforeEach(async () => {
    schedules = [];
    workers = [];
    runs = 0;
    const jobs: JobWorkerRegistry = {
      work: (queue: string): Promise<void> => {
        workers.push(queue);
        return Promise.resolve();
      },
    };
    const useCase: Pick<ExpireCodeEmails, 'execute'> = {
      execute: () => {
        runs += 1;
        return Promise.resolve({ expired: 2 });
      },
    };
    handler = new ExpireCodeEmailsHandler(
      jobs,
      useCase as ExpireCodeEmails,
      EXPIRE_CODE_EMAILS_QUEUE,
    );
    await handler.onApplicationBootstrap();
  });

  it('works the sweep queue without registering its schedule', () => {
    expect(schedules).toEqual([]);
    expect(workers).toEqual(['email.expire-codes']);
  });

  it('registers the sweep every 5 minutes in UTC without working its queue', async () => {
    workers = [];
    const scheduler = new ExpireCodeEmailsScheduleHandler(
      {
        schedule: (queue: string, cron: string, options: JobScheduleOptions): Promise<void> => {
          schedules.push({ queue, cron, timeZone: options.timeZone });
          return Promise.resolve();
        },
      },
      EXPIRE_CODE_EMAILS_QUEUE,
      EXPIRE_CODE_EMAILS_CRON,
    );
    await scheduler.onApplicationBootstrap();
    expect(schedules).toEqual([
      { queue: 'email.expire-codes', cron: '*/5 * * * *', timeZone: 'UTC' },
    ]);
    expect(workers).toEqual([]);
  });

  it('runs the sweep for each job', async () => {
    await handler.handle();

    expect(runs).toBe(1);
  });
});
