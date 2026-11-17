import { beforeEach, describe, expect, it } from 'vitest';
import { ResetLinkToken } from '../../../../../domain/value-objects/security-email/reset-link-token.value-object.js';
import { SendWindow } from '../../../../../domain/value-objects/security-email/send-window.value-object.js';
import {
  FixedClock,
  ImmediateUnitOfWork,
} from '../../../../ports/outbound/persistence/code-email/code-email-deliveries.port.fixture.js';
import { InMemorySecurityEmailDeliveries } from '../../../../ports/outbound/persistence/security-email/security-email-deliveries.port.fixture.js';
import { ExpireSecurityEmails } from './expire-security-emails.use-case.js';

describe('ExpireSecurityEmails', () => {
  let deliveries: InMemorySecurityEmailDeliveries;
  let clock: FixedClock;
  let useCase: ExpireSecurityEmails;
  let deliveryId: string;

  beforeEach(async () => {
    deliveries = new InMemorySecurityEmailDeliveries();
    clock = new FixedClock(new Date('2026-11-09T13:20:00.000Z'));
    useCase = new ExpireSecurityEmails(new ImmediateUnitOfWork(), deliveries, clock);
    // Recorded as a job deleted before it started would leave it: queued, with its token.
    deliveryId =
      (await deliveries.record(
        {
          eventId: '019a6b44-0a1b-7c2d-8e3f-4a5b6c7d8e06',
          userId: '019a5f3c-8d2e-7c4a-9b1f-3e5d7a9c1b30',
          template: 'password-reset',
          language: 'fr',
          window: SendWindow.between(
            new Date('2026-11-09T13:10:00.000Z'),
            new Date('2026-11-09T13:40:00.000Z'),
          ),
          skipReason: null,
        },
        {
          recipientEmail: 'camille.martin@ateliernord.fr',
          recipientName: 'Camille Martin',
          timeZone: 'Europe/Paris',
          details: {
            template: 'password-reset',
            token: ResetLinkToken.of('ExampleOnlyResetToken0000000000000000000000'),
            client: {
              deviceType: 'desktop',
              browser: 'Firefox',
              os: 'Windows',
              osVersion: null,
              ipAddress: '192.0.2.14',
            },
          },
        },
      )) ?? '';
  });

  it('leaves alone an e-mail whose window is still open', async () => {
    expect(await useCase.execute()).toEqual({ expired: 0 });
    expect(deliveries.contents.has(deliveryId)).toBe(true);
  });

  it('settles a queued e-mail whose window closed and deletes its token and address', async () => {
    clock.instant = new Date('2026-11-09T13:45:00.000Z');

    expect(await useCase.execute()).toEqual({ expired: 1 });
    expect(deliveries.deliveries.get(deliveryId)).toMatchObject({
      status: 'skipped',
      skipReason: 'expired',
    });
    expect(deliveries.contents.has(deliveryId)).toBe(false);
  });

  it('finds nothing left to settle the second time', async () => {
    clock.instant = new Date('2026-11-09T13:45:00.000Z');
    await useCase.execute();

    expect(await useCase.execute()).toEqual({ expired: 0 });
  });
});
