import { beforeEach, describe, expect, it } from 'vitest';

import { CodeValidity } from '../../domain/code-email.js';
import { OneTimeCode } from '../../domain/one-time-code.js';
import {
  FixedClock,
  ImmediateUnitOfWork,
  InMemoryCodeEmailDeliveries,
} from '../testing/in-memory-code-emails.js';
import { ExpireCodeEmails } from './expire-code-emails.js';

describe('ExpireCodeEmails', () => {
  let deliveries: InMemoryCodeEmailDeliveries;
  let unitOfWork: ImmediateUnitOfWork;
  let clock: FixedClock;
  let useCase: ExpireCodeEmails;

  /**
   * Function queued
   *
   * @description
   * Records a `queued` sign-in e-mail for Camille Martin, with its content.
   *
   * @param {string} eventId - Id of its event.
   * @param {string} expiresAt - When its code stops working.
   * @returns {Promise<string>} Id of the delivery.
   */
  async function queued(eventId: string, expiresAt: string): Promise<string> {
    const end: Date = new Date(expiresAt);
    return (
      (await deliveries.record(
        {
          eventId,
          codeId: eventId,
          userId: '01938f6e-8a42-7d5b-b2c9-5e1f3a6d9c24',
          purpose: 'sign-in',
          language: 'fr',
          validity: CodeValidity.between(new Date(end.getTime() - 600_000), end),
          skipReason: null,
        },
        {
          code: OneTimeCode.of('482913'),
          recipientEmail: 'camille.martin@ateliernord.fr',
          recipientName: 'Camille Martin',
        },
      )) ?? ''
    );
  }

  beforeEach(() => {
    deliveries = new InMemoryCodeEmailDeliveries();
    unitOfWork = new ImmediateUnitOfWork();
    clock = new FixedClock(new Date('2026-11-09T13:20:00.000Z'));
    useCase = new ExpireCodeEmails(unitOfWork, deliveries, clock);
  });

  it('settles a queued e-mail whose code expired and deletes its code and address', async () => {
    const stale: string = await queued(
      '01938f6f-1a2b-7c3d-8e4f-5a6b7c8d9e01',
      '2026-11-09T13:17:00.000Z',
    );

    expect(await useCase.execute()).toEqual({ expired: 1 });

    expect(deliveries.deliveries.get(stale)).toMatchObject({
      status: 'skipped',
      skipReason: 'expired',
    });
    expect(deliveries.contents.has(stale)).toBe(false);
    expect(unitOfWork.transactions).toBe(1);
  });

  it('leaves alone an e-mail whose code still works', async () => {
    const fresh: string = await queued(
      '01938f6f-1a2b-7c3d-8e4f-5a6b7c8d9e02',
      '2026-11-09T13:25:00.000Z',
    );

    expect(await useCase.execute()).toEqual({ expired: 0 });

    expect(deliveries.deliveries.get(fresh)?.status).toBe('queued');
    expect(deliveries.contents.has(fresh)).toBe(true);
  });

  it('finds nothing left to settle the second time', async () => {
    await queued('01938f6f-1a2b-7c3d-8e4f-5a6b7c8d9e03', '2026-11-09T13:17:00.000Z');

    await useCase.execute();

    expect(await useCase.execute()).toEqual({ expired: 0 });
  });
});
