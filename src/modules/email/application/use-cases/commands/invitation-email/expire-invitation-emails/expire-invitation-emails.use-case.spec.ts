import { beforeEach, describe, expect, it } from 'vitest';
import {
  FixedClock,
  ImmediateUnitOfWork,
} from '../../../../ports/outbound/persistence/code-email/code-email-deliveries.port.fixture.js';
import { InvitationValidity } from '../../../../../domain/value-objects/invitation-email/invitation-validity.value-object.js';
import { InMemoryInvitationEmailDeliveries } from '../../../../ports/outbound/persistence/invitation-email/invitation-email-deliveries.port.fixture.js';
import { ExpireInvitationEmails } from './expire-invitation-emails.use-case.js';

describe('ExpireInvitationEmails', () => {
  let deliveries: InMemoryInvitationEmailDeliveries;
  let unitOfWork: ImmediateUnitOfWork;
  let clock: FixedClock;
  let useCase: ExpireInvitationEmails;

  /**
   * Function recordQueued
   *
   * @description
   * Records a queued invitation e-mail of Atelier Nord, with its content.
   *
   * @param {string} eventId - Id of its event.
   * @param {Date} expiresAt - When the invitation stops working.
   * @returns {Promise<string>} The id of the delivery.
   */
  async function recordQueued(eventId: string, expiresAt: Date): Promise<string> {
    return (
      (await deliveries.record(
        {
          eventId,
          invitationId: eventId,
          invitationVersion: 1,
          role: 'guest',
          language: 'fr',
          validity: InvitationValidity.between(
            new Date(expiresAt.getTime() - 7 * 86_400_000),
            expiresAt,
          ),
          skipReason: null,
        },
        {
          recipientEmail: 'lucie@exemple.fr',
          inviterName: 'Camille Martin',
          organizationName: 'Atelier Nord',
          memberCount: 18,
        },
      )) ?? ''
    );
  }

  beforeEach(() => {
    deliveries = new InMemoryInvitationEmailDeliveries();
    unitOfWork = new ImmediateUnitOfWork();
    clock = new FixedClock(new Date('2026-11-16T10:00:00.000Z'));
    useCase = new ExpireInvitationEmails(unitOfWork, deliveries, clock);
  });

  it('settles the queued e-mails whose invitation expired and deletes their address, in one transaction', async () => {
    const expired: string = await recordQueued(
      '01938f71-1a2b-7c3d-8e4f-5a6b7c8d9e01',
      new Date('2026-11-16T09:15:00.000Z'),
    );
    const valid: string = await recordQueued(
      '01938f71-1a2b-7c3d-8e4f-5a6b7c8d9e02',
      new Date('2026-11-17T09:15:00.000Z'),
    );

    const result: { readonly expired: number } = await useCase.execute();

    expect(result).toEqual({ expired: 1 });
    expect(unitOfWork.transactions).toBe(1);
    expect(deliveries.deliveries.get(expired)).toMatchObject({
      status: 'skipped',
      skipReason: 'expired',
    });
    expect(deliveries.contents.has(expired)).toBe(false);
    expect(deliveries.deliveries.get(valid)?.status).toBe('queued');
    expect(deliveries.contents.has(valid)).toBe(true);
  });
});
