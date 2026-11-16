import {
  SEND_CODE_EMAIL_QUEUE,
  SEND_CODE_EMAIL_MAX_ATTEMPTS,
} from '../../../../../../config/job-queues.js';
import type {
  Job,
  JobHandler,
  JobWorkerRegistry,
  JobWorkOptions,
} from '@cadenway/nest-jobs/runtime';
import { Logger } from '@nestjs/common';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { SendCodeEmail } from '../../../../application/use-cases/commands/code-email/send-code-email/send-code-email.use-case.js';
import type { SendCodeEmailInput } from '../../../../application/use-cases/commands/code-email/send-code-email/send-code-email.input.js';
import { SendCodeEmailHandler } from './send-code-email.handler.js';

/**
 * Function jobOf
 *
 * @description
 * A job of `email.send-code` at an attempt.
 *
 * @param {unknown} payload - Its payload.
 * @param {number} attempt - Its attempt, from 1.
 * @returns {Job} The job.
 */
function jobOf(payload: unknown, attempt: number): Job {
  return {
    id: '01938f70-0000-8000-8000-000000000001',
    queue: 'email.send-code',
    payload,
    organizationId: null,
    attempt,
    signal: new AbortController().signal,
  };
}

describe('SendCodeEmailHandler', () => {
  const deliveryId: string = '01938f6e-0000-7000-8000-000000000001';
  let registered: { queue: string; handler: JobHandler; options: JobWorkOptions | undefined }[];
  let inputs: SendCodeEmailInput[];
  let handler: SendCodeEmailHandler;

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
    const jobs: JobWorkerRegistry = {
      work: (queue: string, work: JobHandler, options?: JobWorkOptions): Promise<void> => {
        registered.push({ queue, handler: work, options });
        return Promise.resolve();
      },
    } as JobWorkerRegistry;
    const useCase: Pick<SendCodeEmail, 'execute'> = {
      execute: (input: SendCodeEmailInput) => {
        inputs.push(input);
        return Promise.resolve({ outcome: 'sent', template: 'sign-in' });
      },
    };
    handler = new SendCodeEmailHandler(
      jobs,
      useCase as SendCodeEmail,
      SEND_CODE_EMAIL_QUEUE,
      SEND_CODE_EMAIL_MAX_ATTEMPTS,
    );
    await handler.onApplicationBootstrap();
  });

  it('works the queue of the code e-mails, polled every second', () => {
    expect(registered.map((entry) => ({ queue: entry.queue, options: entry.options }))).toEqual([
      { queue: 'email.send-code', options: { pollingIntervalSeconds: 1 } },
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
