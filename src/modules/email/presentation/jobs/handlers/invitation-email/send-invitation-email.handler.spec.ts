import {
  SEND_INVITATION_EMAIL_MAX_ATTEMPTS,
  SEND_INVITATION_EMAIL_QUEUE,
} from '../../../../../../config/job-queues.js';
import { getOrganizationContext } from '@cadenway/nest-common';
import type { OrganizationContext } from '@cadenway/nest-common';
import type { Job, JobHandler, JobsService, JobWorkOptions } from '@cadenway/nest-jobs';
import { Logger } from '@nestjs/common';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { SendInvitationEmail } from '../../../../application/use-cases/commands/invitation-email/send-invitation-email/send-invitation-email.use-case.js';
import type { SendInvitationEmailInput } from '../../../../application/use-cases/commands/invitation-email/send-invitation-email/send-invitation-email.input.js';
import { SendInvitationEmailHandler } from './send-invitation-email.handler.js';

/**
 * Constant atelierNordId
 *
 * @description
 * Atelier Nord, the organization of the mockup.
 *
 * @type {string}
 */
const atelierNordId: string = '01938f6e-6d1a-7c3e-9a51-2f0c4b8d7e10';

/**
 * Function jobOf
 *
 * @description
 * A job of `email.send-invitation` at an attempt.
 *
 * @param {unknown} payload - Its payload.
 * @param {number} attempt - Its attempt, from 1.
 * @param {string | null} organizationId - The organization of the enqueuing transaction.
 * @returns {Job} The job.
 */
function jobOf(payload: unknown, attempt: number, organizationId: string | null): Job {
  return {
    id: '01938f72-0000-8000-8000-000000000001',
    queue: 'email.send-invitation',
    payload,
    organizationId,
    attempt,
    signal: new AbortController().signal,
  };
}

describe('SendInvitationEmailHandler', () => {
  const deliveryId: string = '01938f71-0000-7000-8000-000000000001';
  let registered: { queue: string; handler: JobHandler; options: JobWorkOptions | undefined }[];
  let inputs: { readonly input: SendInvitationEmailInput; readonly context: unknown }[];
  let handler: SendInvitationEmailHandler;

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
    const useCase: Pick<SendInvitationEmail, 'execute'> = {
      execute: (input: SendInvitationEmailInput) => {
        const context: OrganizationContext | undefined = getOrganizationContext();
        inputs.push({ input, context });
        return Promise.resolve({ outcome: 'sent' });
      },
    };
    handler = new SendInvitationEmailHandler(
      jobs as JobsService,
      useCase as SendInvitationEmail,
      SEND_INVITATION_EMAIL_QUEUE,
      SEND_INVITATION_EMAIL_MAX_ATTEMPTS,
    );
    await handler.onApplicationBootstrap();
  });

  it('works the queue of the invitation e-mails', () => {
    expect(registered.map((entry) => ({ queue: entry.queue, options: entry.options }))).toEqual([
      { queue: 'email.send-invitation', options: { pollingIntervalSeconds: 2 } },
    ]);
  });

  it('sends in the organization that enqueued the job, as the system', async () => {
    await handler.handle(jobOf({ deliveryId }, 1, atelierNordId));

    expect(inputs.map((entry) => entry.context)).toEqual([
      {
        organizationId: atelierNordId,
        actor: { type: 'system', id: null },
        role: null,
        scopes: [],
      },
    ]);
  });

  it('tells the use case which attempt is the last of the five, with the signal of the attempt', async () => {
    for (const attempt of [1, 4, 5]) {
      await handler.handle(jobOf({ deliveryId }, attempt, atelierNordId));
    }

    expect(
      inputs.map(({ input }) => ({ deliveryId: input.deliveryId, lastAttempt: input.lastAttempt })),
    ).toEqual([
      { deliveryId, lastAttempt: false },
      { deliveryId, lastAttempt: false },
      { deliveryId, lastAttempt: true },
    ]);
    expect(inputs.every(({ input }) => input.signal instanceof AbortSignal)).toBe(true);
  });

  it('refuses a job without a delivery id or without an organization', async () => {
    await expect(
      handler.handle(jobOf({ deliveryId: 'CAD-482' }, 1, atelierNordId)),
    ).rejects.toThrow();
    await expect(handler.handle(jobOf(null, 1, atelierNordId))).rejects.toThrow();
    await expect(handler.handle(jobOf({ deliveryId }, 1, null))).rejects.toThrow();
    expect(inputs).toEqual([]);
  });
});
