import {
  SEND_SECURITY_EMAIL_QUEUE,
  SEND_SECURITY_EMAIL_MAX_ATTEMPTS,
} from '../../../../../../config/job-queues.js';
import type { Job, JobHandler, JobsService, JobWorkOptions } from '@cadenway/nest-jobs';
import { Logger } from '@nestjs/common';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { SendSecurityEmail } from '../../../../application/use-cases/commands/security-email/send-security-email/send-security-email.use-case.js';
import type { SendSecurityEmailInput } from '../../../../application/use-cases/commands/security-email/send-security-email/send-security-email.input.js';
import { SendSecurityEmailHandler } from './send-security-email.handler.js';

/**
 * Function jobOf
 *
 * @description
 * A job of `email.send-security` at an attempt.
 *
 * @param {unknown} payload - Its payload.
 * @param {number} attempt - Its attempt, from 1.
 * @returns {Job} The job.
 */
function jobOf(payload: unknown, attempt: number): Job {
  return {
    id: '01938f70-0000-8000-8000-000000000001',
    queue: 'email.send-security',
    payload,
    organizationId: null,
    attempt,
    signal: new AbortController().signal,
  };
}

describe('SendSecurityEmailHandler', () => {
  const deliveryId: string = '01938f6e-0000-7000-8000-000000000001';
  let registered: { queue: string; handler: JobHandler; options: JobWorkOptions | undefined }[];
  let inputs: SendSecurityEmailInput[];
  let handler: SendSecurityEmailHandler;

  beforeAll(() => {
    // The handler logs each outcome; the console of the test run stays quiet.
    Logger.overrideLogger(false);
  });

  afterAll(() => {
    Logger.overrideLogger(['log', 'error', 'warn', 'debug', 'verbose', 'fatal']);
  });

  beforeEach(async () => {
    registered = [];
    inputs = [];
    const jobs: Pick<JobsService, 'work'> = {
      work: (queue: string, work: JobHandler, options?: JobWorkOptions): Promise<void> => {
        registered.push({ queue, handler: work, options });
        return Promise.resolve();
      },
    } as Pick<JobsService, 'work'>;
    const useCase: Pick<SendSecurityEmail, 'execute'> = {
      execute: (input: SendSecurityEmailInput) => {
        inputs.push(input);
        return Promise.resolve({ outcome: 'sent', template: 'password-reset' });
      },
    };
    handler = new SendSecurityEmailHandler(
      jobs as JobsService,
      useCase as SendSecurityEmail,
      SEND_SECURITY_EMAIL_QUEUE,
      SEND_SECURITY_EMAIL_MAX_ATTEMPTS,
    );
    await handler.onApplicationBootstrap();
  });

  it('works the queue of the security e-mails, polled every second', () => {
    expect(registered.map((entry) => ({ queue: entry.queue, options: entry.options }))).toEqual([
      { queue: 'email.send-security', options: { pollingIntervalSeconds: 1 } },
    ]);
  });

  it('tells the use case which attempt is the last of the five, with the signal of the attempt', async () => {
    for (const attempt of [1, 4, 5]) {
      await handler.handle(jobOf({ deliveryId }, attempt));
    }

    expect(
      inputs.map((input) => ({ deliveryId: input.deliveryId, lastAttempt: input.lastAttempt })),
    ).toEqual([
      { deliveryId, lastAttempt: false },
      { deliveryId, lastAttempt: false },
      { deliveryId, lastAttempt: true },
    ]);
    expect(inputs.every((input) => input.signal instanceof AbortSignal)).toBe(true);
  });

  it('refuses a payload that is not a delivery id', async () => {
    await expect(handler.handle(jobOf({ deliveryId: 'CAD-482' }, 1))).rejects.toThrow();
    await expect(handler.handle(jobOf(null, 1))).rejects.toThrow();
    expect(inputs).toEqual([]);
  });
});
