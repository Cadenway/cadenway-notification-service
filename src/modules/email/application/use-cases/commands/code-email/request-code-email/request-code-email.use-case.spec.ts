import { beforeEach, describe, expect, it } from 'vitest';
import { InvalidOneTimeCodeError } from '../../../../../domain/errors/code-email/invalid-one-time-code.error.js';
import {
  FixedClock,
  ImmediateUnitOfWork,
  InMemoryCodeEmailDeliveries,
  InMemoryCodeEmailQueue,
} from '../../../../ports/outbound/persistence/code-email/code-email-deliveries.port.fixture.js';
import { RequestCodeEmail } from './request-code-email.use-case.js';
import type { RequestCodeEmailInput } from './request-code-email.input.js';
import type { RequestCodeEmailOutput } from './request-code-email.output.js';

/**
 * Function issuedCode
 *
 * @description
 * The sign-in code Camille Martin asks for in the mockup, valid 10 minutes from 14:07 in Paris.
 *
 * @param {Partial<RequestCodeEmailInput>} overrides - Fields to change.
 * @returns {RequestCodeEmailInput} The input of the use case.
 */
function issuedCode(overrides: Partial<RequestCodeEmailInput> = {}): RequestCodeEmailInput {
  return {
    eventId: '01938f6f-1a2b-7c3d-8e4f-5a6b7c8d9e01',
    codeId: '01938f6f-1a2b-7c3d-8e4f-5a6b7c8d9e02',
    userId: '01938f6e-8a42-7d5b-b2c9-5e1f3a6d9c24',
    purpose: 'sign-in',
    code: '482913',
    issuedAt: new Date('2026-11-09T13:07:00.000Z'),
    expiresAt: new Date('2026-11-09T13:17:00.000Z'),
    recipient: { email: 'camille.martin@ateliernord.fr', name: 'Camille Martin' },
    language: 'fr',
    ...overrides,
  };
}

describe('RequestCodeEmail', () => {
  let deliveries: InMemoryCodeEmailDeliveries;
  let queue: InMemoryCodeEmailQueue;
  let unitOfWork: ImmediateUnitOfWork;
  let clock: FixedClock;
  let useCase: RequestCodeEmail;

  beforeEach(() => {
    deliveries = new InMemoryCodeEmailDeliveries();
    queue = new InMemoryCodeEmailQueue();
    unitOfWork = new ImmediateUnitOfWork();
    clock = new FixedClock(new Date('2026-11-09T13:07:01.000Z'));
    useCase = new RequestCodeEmail(unitOfWork, deliveries, queue, clock);
  });

  it('records a valid code as queued, keeps its content apart and enqueues one job, in one transaction', async () => {
    const result: RequestCodeEmailOutput = await useCase.execute(issuedCode());

    expect(result).toEqual({ outcome: 'queued', deliveryId: expect.any(String) as string });
    const deliveryId: string = result.outcome === 'queued' ? result.deliveryId : '';
    expect(queue.enqueued).toEqual([deliveryId]);
    expect(unitOfWork.transactions).toBe(1);
    expect(deliveries.deliveries.get(deliveryId)).toMatchObject({
      status: 'queued',
      skipReason: null,
      draft: { purpose: 'sign-in', eventId: '01938f6f-1a2b-7c3d-8e4f-5a6b7c8d9e01' },
    });
    expect(deliveries.contents.get(deliveryId)).toMatchObject({
      recipientEmail: 'camille.martin@ateliernord.fr',
      recipientName: 'Camille Martin',
    });
    expect(deliveries.contents.get(deliveryId)?.code.reveal()).toBe('482913');
  });

  it('keeps the name of the recipient without the characters that would break the e-mail', async () => {
    const result: RequestCodeEmailOutput = await useCase.execute(
      issuedCode({
        recipient: {
          email: 'camille.martin@ateliernord.fr',
          name: 'Camille\r\nVotre compte est suspendu.‮',
        },
      }),
    );

    const deliveryId: string = result.outcome === 'queued' ? result.deliveryId : '';
    expect(deliveries.contents.get(deliveryId)?.recipientName).toBe(
      'Camille Votre compte est suspendu.',
    );
  });

  it('keeps neither the code nor the address in the send log', async () => {
    await useCase.execute(issuedCode());

    const log: string = JSON.stringify([...deliveries.deliveries.values()]);
    expect(log).not.toContain('482913');
    expect(log).not.toContain('camille.martin@ateliernord.fr');
  });

  it('records a code that already expired as skipped, with no content and no job', async () => {
    clock.instant = new Date('2026-11-09T13:17:00.000Z');

    const result: RequestCodeEmailOutput = await useCase.execute(issuedCode());

    expect(result).toMatchObject({ outcome: 'skipped', reason: 'expired' });
    expect(queue.enqueued).toEqual([]);
    expect(deliveries.contents.size).toBe(0);
    expect([...deliveries.deliveries.values()]).toMatchObject([
      { status: 'skipped', skipReason: 'expired' },
    ]);
  });

  it('queues an address-change code like the others', async () => {
    const result: RequestCodeEmailOutput = await useCase.execute(
      issuedCode({ purpose: 'email-change' }),
    );

    expect(result).toMatchObject({ outcome: 'queued' });
    expect(queue.enqueued).toHaveLength(1);
    expect(deliveries.contents.size).toBe(1);
  });

  it('writes nothing for an event it already recorded', async () => {
    await useCase.execute(issuedCode());

    const again: RequestCodeEmailOutput = await useCase.execute(issuedCode());

    expect(again).toEqual({ outcome: 'duplicate' });
    expect(deliveries.deliveries.size).toBe(1);
    expect(queue.enqueued).toHaveLength(1);
  });

  it('refuses a code that is not 6 digits before writing anything', async () => {
    await expect(useCase.execute(issuedCode({ code: '48291' }))).rejects.toThrow(
      InvalidOneTimeCodeError,
    );
    expect(unitOfWork.transactions).toBe(0);
  });
});
