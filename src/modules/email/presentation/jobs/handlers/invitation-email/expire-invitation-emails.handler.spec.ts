import {
  EXPIRE_INVITATION_EMAILS_CRON,
  EXPIRE_INVITATION_EMAILS_QUEUE,
} from '../../../../../../config/job-queues.js';
import type { JobScheduleOptions, JobsService } from '@cadenway/nest-jobs';
import { Logger } from '@nestjs/common';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { ExpireInvitationEmails } from '../../../../application/use-cases/commands/invitation-email/expire-invitation-emails/expire-invitation-emails.use-case.js';
import { ExpireInvitationEmailsHandler } from './expire-invitation-emails.handler.js';

describe('ExpireInvitationEmailsHandler', () => {
  let schedules: { readonly queue: string; readonly cron: string; readonly timeZone: string }[];
  let workers: string[];
  let runs: number;
  let handler: ExpireInvitationEmailsHandler;

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
    const useCase: Pick<ExpireInvitationEmails, 'execute'> = {
      execute: () => {
        runs += 1;
        return Promise.resolve({ expired: 1 });
      },
    };
    handler = new ExpireInvitationEmailsHandler(
      jobs as JobsService,
      useCase as ExpireInvitationEmails,
      EXPIRE_INVITATION_EMAILS_QUEUE,
      EXPIRE_INVITATION_EMAILS_CRON,
    );
    await handler.onApplicationBootstrap();
  });

  it('schedules the sweep every hour in UTC and works its queue', () => {
    expect(schedules).toEqual([
      { queue: 'email.expire-invitations', cron: '0 * * * *', timeZone: 'UTC' },
    ]);
    expect(workers).toEqual(['email.expire-invitations']);
  });

  it('runs the sweep for each job', async () => {
    await handler.handle();

    expect(runs).toBe(1);
  });
});
