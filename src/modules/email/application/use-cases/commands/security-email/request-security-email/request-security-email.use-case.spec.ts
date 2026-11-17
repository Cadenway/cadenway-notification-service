import { beforeEach, describe, expect, it } from 'vitest';
import { InvalidResetLinkTokenError } from '../../../../../domain/errors/security-email/invalid-reset-link-token.error.js';
import { InvalidSendWindowError } from '../../../../../domain/errors/security-email/invalid-send-window.error.js';
import type { SecurityEmailContent } from '../../../../models/security-email/security-email-content.model.js';
import type { SecurityEmailRequestClient } from '../../../../models/security-email/security-email-request-client.model.js';
import {
  FixedClock,
  ImmediateUnitOfWork,
} from '../../../../ports/outbound/persistence/code-email/code-email-deliveries.port.fixture.js';
import {
  InMemorySecurityEmailDeliveries,
  InMemorySecurityEmailQueue,
} from '../../../../ports/outbound/persistence/security-email/security-email-deliveries.port.fixture.js';
import type { RequestSecurityEmailInput } from './request-security-email.input.js';
import type { RequestSecurityEmailOutput } from './request-security-email.output.js';
import { RequestSecurityEmail } from './request-security-email.use-case.js';

/**
 * Constant TOKEN
 *
 * @description
 * The token of the example of `password-reset-link.issued.v1` in the contract.
 *
 * @type {string}
 */
const TOKEN: string = 'ExampleOnlyResetToken0000000000000000000000';

/**
 * Constant firefoxOnWindows
 *
 * @description
 * The browser of Camille Martin, as the identity-service events give it.
 *
 * @type {SecurityEmailRequestClient}
 */
const firefoxOnWindows: SecurityEmailRequestClient = {
  device: { type: 'desktop', browser: 'Firefox', os: 'Windows', osVersion: null },
  ipAddress: '192.0.2.14',
};

/**
 * Function resetRequested
 *
 * @description
 * The reset link Camille Martin asked for on 9 November 2026 at 14:10 in Paris, valid 30 minutes.
 *
 * @param {Partial<RequestSecurityEmailInput>} overrides - Fields to change.
 * @returns {RequestSecurityEmailInput} The input.
 */
function resetRequested(
  overrides: Partial<RequestSecurityEmailInput> = {},
): RequestSecurityEmailInput {
  return {
    eventId: '019a6b44-0a1b-7c2d-8e3f-4a5b6c7d8e06',
    userId: '019a5f3c-8d2e-7c4a-9b1f-3e5d7a9c1b30',
    occurredAt: new Date('2026-11-09T13:10:00.000Z'),
    recipient: { email: 'camille.martin@ateliernord.fr', name: 'Camille Martin' },
    language: 'fr',
    timeZone: 'Europe/Paris',
    request: {
      template: 'password-reset',
      token: TOKEN,
      expiresAt: new Date('2026-11-09T13:40:00.000Z'),
      client: firefoxOnWindows,
    },
    ...overrides,
  };
}

describe('RequestSecurityEmail', () => {
  let deliveries: InMemorySecurityEmailDeliveries;
  let queue: InMemorySecurityEmailQueue;
  let clock: FixedClock;
  let unitOfWork: ImmediateUnitOfWork;
  let useCase: RequestSecurityEmail;

  beforeEach(() => {
    deliveries = new InMemorySecurityEmailDeliveries();
    queue = new InMemorySecurityEmailQueue();
    clock = new FixedClock(new Date('2026-11-09T13:10:01.000Z'));
    unitOfWork = new ImmediateUnitOfWork();
    useCase = new RequestSecurityEmail(unitOfWork, deliveries, queue, clock);
  });

  it('records a reset e-mail, keeps its token with the content only, and enqueues one job', async () => {
    const result: RequestSecurityEmailOutput = await useCase.execute(resetRequested());

    expect(result).toEqual({ outcome: 'queued', deliveryId: queue.enqueued[0] });
    expect(unitOfWork.transactions).toBe(1);
    const [stored] = [...deliveries.deliveries.values()];
    expect(stored?.draft).toMatchObject({
      eventId: '019a6b44-0a1b-7c2d-8e3f-4a5b6c7d8e06',
      userId: '019a5f3c-8d2e-7c4a-9b1f-3e5d7a9c1b30',
      template: 'password-reset',
      language: 'fr',
      skipReason: null,
    });
    expect(stored?.draft.window.minutes).toBe(30);
    expect(JSON.stringify(stored?.draft)).not.toContain(TOKEN);
    const content: SecurityEmailContent | undefined = deliveries.contents.get(
      queue.enqueued[0] ?? '',
    );
    expect(content?.details.template === 'password-reset' && content.details.token.reveal()).toBe(
      TOKEN,
    );
    expect(JSON.stringify(content)).not.toContain(TOKEN);
  });

  it('keeps the browser without its version, every text cleaned', async () => {
    await useCase.execute(
      resetRequested({
        recipient: { email: 'camille.martin@ateliernord.fr', name: 'Camille\u202e Martin\n' },
        request: {
          template: 'new-device',
          client: {
            device: { type: 'mobile', browser: 'Safari\u200b', os: '\u2028', osVersion: '18.1' },
            ipAddress: '86.247.12.30',
          },
        },
      }),
    );

    expect([...deliveries.contents.values()]).toEqual([
      {
        recipientEmail: 'camille.martin@ateliernord.fr',
        recipientName: 'Camille Martin',
        timeZone: 'Europe/Paris',
        details: {
          template: 'new-device',
          client: {
            deviceType: 'mobile',
            browser: 'Safari',
            os: null,
            osVersion: '18.1',
            ipAddress: '86.247.12.30',
          },
        },
      },
    ]);
  });

  it('keeps none of the device texts that do not look like what they claim to be', async () => {
    await useCase.execute(
      resetRequested({
        request: {
          template: 'password-reset',
          token: TOKEN,
          expiresAt: new Date('2026-11-09T13:40:00.000Z'),
          client: {
            device: {
              type: '__proto__',
              browser: 'Appelez le 0612345678',
              os: 'cadenway-support.example',
              osVersion: '18.1 beta',
            },
            ipAddress: 'evil.example',
          },
        },
      }),
    );

    const [content] = [...deliveries.contents.values()];
    expect(content?.details).toMatchObject({
      template: 'password-reset',
      client: { deviceType: 'unknown', browser: null, os: null, osVersion: null, ipAddress: null },
    });
  });

  it('gives a notice a day to leave', async () => {
    await useCase.execute(
      resetRequested({
        request: { template: 'deletion-scheduled', deleteAt: new Date('2026-12-09T13:10:00Z') },
      }),
    );

    const [stored] = [...deliveries.deliveries.values()];
    expect(stored?.draft.window.sendBefore).toEqual(new Date('2026-11-10T13:10:00.000Z'));
  });

  it('records a reset link that expired before the event arrived as skipped, without content or job', async () => {
    clock.instant = new Date('2026-11-09T13:40:00.000Z');

    const result: RequestSecurityEmailOutput = await useCase.execute(resetRequested());

    expect(result).toMatchObject({ outcome: 'skipped', reason: 'expired' });
    expect(queue.enqueued).toEqual([]);
    expect(deliveries.contents.size).toBe(0);
  });

  it('records a notice more than a day old as skipped', async () => {
    clock.instant = new Date('2026-11-10T13:10:00.000Z');

    const result: RequestSecurityEmailOutput = await useCase.execute(
      resetRequested({
        request: {
          template: 'password-changed',
          method: 'change',
          closedSessionCount: 0,
          client: firefoxOnWindows,
        },
      }),
    );

    expect(result).toMatchObject({ outcome: 'skipped', reason: 'expired' });
    expect(deliveries.contents.size).toBe(0);
  });

  it('writes nothing for an event it already recorded: one e-mail per event', async () => {
    await useCase.execute(resetRequested());

    const again: RequestSecurityEmailOutput = await useCase.execute(resetRequested());

    expect(again).toEqual({ outcome: 'duplicate' });
    expect(deliveries.deliveries.size).toBe(1);
    expect(queue.enqueued).toHaveLength(1);
  });

  it('refuses a token that breaks the contract, without quoting it', async () => {
    const request: RequestSecurityEmailInput = resetRequested();

    await expect(
      useCase.execute({
        ...request,
        request: {
          template: 'password-reset',
          token: 'short',
          expiresAt: new Date('2026-11-09T13:40:00.000Z'),
          client: firefoxOnWindows,
        },
      }),
    ).rejects.toThrow(InvalidResetLinkTokenError);
    expect(deliveries.deliveries.size).toBe(0);
  });

  it('refuses a link that expires before it was issued, or more than a day later', async () => {
    for (const expiresAt of ['2026-11-09T13:10:00.000Z', '2026-11-10T13:10:01.000Z']) {
      await expect(
        useCase.execute(
          resetRequested({
            request: {
              template: 'password-reset',
              token: TOKEN,
              expiresAt: new Date(expiresAt),
              client: firefoxOnWindows,
            },
          }),
        ),
      ).rejects.toThrow(InvalidSendWindowError);
    }
    expect(deliveries.deliveries.size).toBe(0);
  });
});
