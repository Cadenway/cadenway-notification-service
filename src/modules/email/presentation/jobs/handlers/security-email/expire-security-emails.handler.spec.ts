import {
  EXPIRE_SECURITY_EMAILS_QUEUE,
  EXPIRE_SECURITY_EMAILS_CRON,
} from '../../../../../../config/job-queues.js';
import type { JobScheduleOptions, JobsService } from '@cadenway/nest-jobs';
import { Logger } from '@nestjs/common';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { ExpireSecurityEmails } from '../../../../application/use-cases/commands/security-email/expire-security-emails/expire-security-emails.use-case.js';
import { ExpireSecurityEmailsHandler } from './expire-security-emails.handler.js';

describe('ExpireSecurityEmailsHandler', () => {
  let schedules: { readonly queue: string; readonly cron: string; readonly timeZone: string }[];
  let workers: string[];
  let runs: number;
  let handler: ExpireSecurityEmailsHandler;

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
    const useCase: Pick<ExpireSecurityEmails, 'execute'> = {
      execute: () => {
        runs += 1;
        return Promise.resolve({ expired: 2 });
      },
    };
    handler = new ExpireSecurityEmailsHandler(
      jobs as JobsService,
      useCase as ExpireSecurityEmails,
      EXPIRE_SECURITY_EMAILS_QUEUE,
      EXPIRE_SECURITY_EMAILS_CRON,
    );
    await handler.onApplicationBootstrap();
  });

  it('schedules the sweep every 5 minutes in UTC and works its queue', () => {
    expect(schedules).toEqual([
      { queue: 'email.expire-security', cron: '*/5 * * * *', timeZone: 'UTC' },
    ]);
    expect(workers).toEqual(['email.expire-security']);
  });

  it('runs the sweep for each job', async () => {
    await handler.handle();

    expect(runs).toBe(1);
  });
});
