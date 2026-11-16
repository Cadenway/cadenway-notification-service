import {
  EXPIRE_CODE_EMAILS_QUEUE,
  EXPIRE_CODE_EMAILS_CRON,
} from '../../../../../../config/job-queues.js';
import type { JobScheduleOptions, JobsService } from '@cadenway/nest-jobs';
import { Logger } from '@nestjs/common';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { ExpireCodeEmails } from '../../../../application/use-cases/commands/code-email/expire-code-emails/expire-code-emails.use-case.js';
import { ExpireCodeEmailsHandler } from './expire-code-emails.handler.js';

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
    const jobs: Pick<JobsService, 'schedule' | 'work'> = {
      schedule: (queue: string, cron: string, options: JobScheduleOptions): Promise<void> => {
        schedules.push({ queue, cron, timeZone: options.timeZone });
        return Promise.resolve();
      },
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
      jobs as JobsService,
      useCase as ExpireCodeEmails,
      EXPIRE_CODE_EMAILS_QUEUE,
      EXPIRE_CODE_EMAILS_CRON,
    );
    await handler.onApplicationBootstrap();
  });

  it('schedules the sweep every 5 minutes in UTC and works its queue', () => {
    expect(schedules).toEqual([
      { queue: 'email.expire-codes', cron: '*/5 * * * *', timeZone: 'UTC' },
    ]);
    expect(workers).toEqual(['email.expire-codes']);
  });

  it('runs the sweep for each job', async () => {
    await handler.handle();

    expect(runs).toBe(1);
  });
});
