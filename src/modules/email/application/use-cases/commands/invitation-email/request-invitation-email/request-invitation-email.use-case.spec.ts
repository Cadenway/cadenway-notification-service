import { beforeEach, describe, expect, it } from 'vitest';
import { InvalidInvitationExpiryError } from '../../../../../domain/errors/invitation-email/invalid-invitation-expiry.error.js';
import {
  FixedClock,
  ImmediateUnitOfWork,
} from '../../../../ports/outbound/persistence/code-email/code-email-deliveries.port.fixture.js';
import {
  InMemoryInvitationEmailDeliveries,
  InMemoryInvitationEmailQueue,
} from '../../../../ports/outbound/persistence/invitation-email/invitation-email-deliveries.port.fixture.js';
import { RequestInvitationEmail } from './request-invitation-email.use-case.js';
import type { RequestInvitationEmailInput } from './request-invitation-email.input.js';
import type { RequestInvitationEmailOutput } from './request-invitation-email.output.js';

/**
 * Constant invitationId
 *
 * @description
 * The invitation of the mockup, sent by Hugo Durand to join Atelier Nord.
 *
 * @type {string}
 */
const invitationId: string = '01938f71-5d0b-7c3e-9a51-2f0c4b8d7e10';

/**
 * Function issuedInvitation
 *
 * @description
 * The invitation of the "Invitation" e-mail of the mockup: Hugo Durand invites Marc Roux to join
 * Atelier Nord (18 members) as Membre, until 16 November 2026.
 *
 * @param {Partial<RequestInvitationEmailInput>} overrides - Fields to change.
 * @returns {RequestInvitationEmailInput} The input of the use case.
 */
function issuedInvitation(
  overrides: Partial<RequestInvitationEmailInput> = {},
): RequestInvitationEmailInput {
  return {
    eventId: '01938f71-1a2b-7c3d-8e4f-5a6b7c8d9e01',
    invitationId,
    version: 1,
    latestVersion: true,
    recipientEmail: 'marc.roux@ateliernord.fr',
    role: 'member',
    inviterName: 'Hugo Durand',
    organizationName: 'Atelier Nord',
    memberCount: 18,
    issuedAt: new Date('2026-11-09T09:15:00.000Z'),
    expiresAt: new Date('2026-11-16T09:15:00.000Z'),
    language: 'fr',
    ...overrides,
  };
}

describe('RequestInvitationEmail', () => {
  let deliveries: InMemoryInvitationEmailDeliveries;
  let queue: InMemoryInvitationEmailQueue;
  let unitOfWork: ImmediateUnitOfWork;
  let clock: FixedClock;
  let useCase: RequestInvitationEmail;

  beforeEach(() => {
    deliveries = new InMemoryInvitationEmailDeliveries();
    queue = new InMemoryInvitationEmailQueue();
    unitOfWork = new ImmediateUnitOfWork();
    clock = new FixedClock(new Date('2026-11-09T09:15:01.000Z'));
    useCase = new RequestInvitationEmail(unitOfWork, deliveries, queue, clock);
  });

  it('records a valid invitation as queued, keeps its content apart and enqueues one job, in one transaction', async () => {
    const result: RequestInvitationEmailOutput = await useCase.execute(issuedInvitation());

    expect(result).toEqual({
      outcome: 'queued',
      deliveryId: expect.any(String) as string,
      superseded: 0,
    });
    const deliveryId: string = result.outcome === 'queued' ? result.deliveryId : '';
    expect(queue.enqueued).toEqual([deliveryId]);
    expect(unitOfWork.transactions).toBe(1);
    expect(deliveries.deliveries.get(deliveryId)).toMatchObject({
      status: 'queued',
      skipReason: null,
      draft: { invitationId, invitationVersion: 1, role: 'member', language: 'fr' },
    });
    expect(deliveries.contents.get(deliveryId)).toEqual({
      recipientEmail: 'marc.roux@ateliernord.fr',
      inviterName: 'Hugo Durand',
      organizationName: 'Atelier Nord',
      memberCount: 18,
    });
  });

  it('keeps the names without the characters that would break the e-mail', async () => {
    const result: RequestInvitationEmailOutput = await useCase.execute(
      issuedInvitation({
        inviterName: 'Hugo\r\nDurand‮',
        organizationName: 'Atelier\nNord​',
      }),
    );

    const deliveryId: string = result.outcome === 'queued' ? result.deliveryId : '';
    expect(deliveries.contents.get(deliveryId)).toMatchObject({
      inviterName: 'Hugo Durand',
      organizationName: 'Atelier Nord',
    });
  });

  it('keeps neither the address nor a name in the send log', async () => {
    await useCase.execute(issuedInvitation());

    const log: string = JSON.stringify([...deliveries.deliveries.values()]);
    expect(log).not.toContain('marc.roux@ateliernord.fr');
    expect(log).not.toContain('Hugo Durand');
    expect(log).not.toContain('Atelier Nord');
  });

  it('records an invitation that already expired as skipped, with no content and no job', async () => {
    clock.instant = new Date('2026-11-16T09:15:00.000Z');

    const result: RequestInvitationEmailOutput = await useCase.execute(issuedInvitation());

    expect(result).toMatchObject({ outcome: 'skipped', reason: 'expired' });
    expect(queue.enqueued).toEqual([]);
    expect(deliveries.contents.size).toBe(0);
  });

  it('records a version older than one already received as superseded, and sends nothing', async () => {
    const result: RequestInvitationEmailOutput = await useCase.execute(
      issuedInvitation({ latestVersion: false }),
    );

    expect(result).toMatchObject({ outcome: 'skipped', reason: 'superseded' });
    expect(queue.enqueued).toEqual([]);
    expect(deliveries.contents.size).toBe(0);
  });

  it('enqueues a resend, and skips the first sending still waiting so only the latest leaves', async () => {
    const first: RequestInvitationEmailOutput = await useCase.execute(issuedInvitation());

    const resend: RequestInvitationEmailOutput = await useCase.execute(
      issuedInvitation({
        eventId: '01938f71-1a2b-7c3d-8e4f-5a6b7c8d9e02',
        version: 2,
        issuedAt: new Date('2026-11-10T09:15:00.000Z'),
        expiresAt: new Date('2026-11-17T09:15:00.000Z'),
      }),
    );

    const firstId: string = first.outcome === 'queued' ? first.deliveryId : '';
    const resendId: string = resend.outcome === 'queued' ? resend.deliveryId : '';
    expect(resend).toMatchObject({ outcome: 'queued', superseded: 1 });
    expect(queue.enqueued).toEqual([firstId, resendId]);
    expect(deliveries.deliveries.get(firstId)).toMatchObject({
      status: 'skipped',
      skipReason: 'superseded',
    });
    expect(deliveries.contents.has(firstId)).toBe(false);
    expect(deliveries.contents.has(resendId)).toBe(true);
  });

  it('leaves a first sending already sent untouched when the resend arrives', async () => {
    const first: RequestInvitationEmailOutput = await useCase.execute(issuedInvitation());
    const firstId: string = first.outcome === 'queued' ? first.deliveryId : '';
    await deliveries.markSent(firstId);

    const resend: RequestInvitationEmailOutput = await useCase.execute(
      issuedInvitation({ eventId: '01938f71-1a2b-7c3d-8e4f-5a6b7c8d9e02', version: 2 }),
    );

    expect(resend).toMatchObject({ outcome: 'queued', superseded: 0 });
    expect(deliveries.deliveries.get(firstId)?.status).toBe('sent');
  });

  it('writes nothing for an event it already recorded', async () => {
    await useCase.execute(issuedInvitation());

    const again: RequestInvitationEmailOutput = await useCase.execute(issuedInvitation());

    expect(again).toEqual({ outcome: 'duplicate' });
    expect(deliveries.deliveries.size).toBe(1);
    expect(queue.enqueued).toHaveLength(1);
  });

  it('refuses an expiry that is not an instant before writing anything', async () => {
    await expect(
      useCase.execute(issuedInvitation({ expiresAt: new Date(Number.NaN) })),
    ).rejects.toThrow(InvalidInvitationExpiryError);
    expect(unitOfWork.transactions).toBe(0);
  });

  it('refuses an invitation valid far longer than the 7 days of the contract, so its address is never kept for long', async () => {
    await expect(
      useCase.execute(issuedInvitation({ expiresAt: new Date('2099-01-01T00:00:00.000Z') })),
    ).rejects.toThrow(InvalidInvitationExpiryError);
    expect(unitOfWork.transactions).toBe(0);
    expect(deliveries.contents.size).toBe(0);
  });
});
