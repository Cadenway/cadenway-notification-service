import { beforeEach, describe, expect, it } from 'vitest';
import { AttemptAbandonedError } from '../../../../models/code-email/attempt-abandoned-error.model.js';
import type { RenderedEmail } from '../../../../models/code-email/rendered-email.model.js';
import type { InvitationEmailMessage } from '../../../../models/invitation-email/invitation-email-message.model.js';
import { InvitationValidity } from '../../../../../domain/value-objects/invitation-email/invitation-validity.value-object.js';
import {
  FixedClock,
  ImmediateUnitOfWork,
  RecordingEmailSender,
} from '../../../../ports/outbound/persistence/code-email/code-email-deliveries.port.fixture.js';
import { InMemoryInvitationEmailDeliveries } from '../../../../ports/outbound/persistence/invitation-email/invitation-email-deliveries.port.fixture.js';
import type { InvitationEmailRenderer } from '../../../../ports/outbound/templates/invitation-email/invitation-email-renderer.port.js';
import { SendInvitationEmail } from './send-invitation-email.use-case.js';
import type { SendInvitationEmailOutput } from './send-invitation-email.output.js';

/**
 * Class EchoRenderer
 *
 * @description
 * `InvitationEmailRenderer` that writes what it was asked to render, to check what the use case
 * passes.
 */
class EchoRenderer implements InvitationEmailRenderer {
  // #region Methods
  /**
   * Method renderInvitationEmail
   *
   * @description
   * Renders the message as plain fields.
   *
   * @param {InvitationEmailMessage} message - The message.
   * @returns {RenderedEmail} A minimal e-mail.
   */
  public renderInvitationEmail(message: InvitationEmailMessage): RenderedEmail {
    const line: string = [
      message.inviterName,
      message.organizationName,
      String(message.memberCount),
      message.role,
      message.invitationId,
      message.expiresAt.toISOString(),
    ].join(' ');
    return { subject: 'invitation subject', html: `<p>${line}</p>`, text: line };
  }
  // #endregion
}

describe('SendInvitationEmail', () => {
  const invitationId: string = '01938f71-5d0b-7c3e-9a51-2f0c4b8d7e10';
  let deliveries: InMemoryInvitationEmailDeliveries;
  let sender: RecordingEmailSender;
  let clock: FixedClock;
  let unitOfWork: ImmediateUnitOfWork;
  let useCase: SendInvitationEmail;
  let deliveryId: string;

  beforeEach(async () => {
    deliveries = new InMemoryInvitationEmailDeliveries();
    sender = new RecordingEmailSender();
    clock = new FixedClock(new Date('2026-11-09T09:15:02.000Z'));
    unitOfWork = new ImmediateUnitOfWork();
    useCase = new SendInvitationEmail(unitOfWork, deliveries, new EchoRenderer(), sender, clock);
    deliveryId =
      (await deliveries.record(
        {
          eventId: '01938f71-1a2b-7c3d-8e4f-5a6b7c8d9e01',
          invitationId,
          invitationVersion: 1,
          role: 'member',
          language: 'fr',
          validity: InvitationValidity.between(
            new Date('2026-11-09T09:15:00.000Z'),
            new Date('2026-11-16T09:15:00.000Z'),
          ),
          skipReason: null,
        },
        {
          recipientEmail: 'marc.roux@ateliernord.fr',
          inviterName: 'Hugo Durand',
          organizationName: 'Atelier Nord',
          memberCount: 18,
        },
      )) ?? '';
  });

  it('sends a queued e-mail to the address alone, with the one-click unsubscription, then marks it sent and deletes its content', async () => {
    const result: SendInvitationEmailOutput = await useCase.execute({
      deliveryId,
      lastAttempt: false,
    });

    const line: string = `Hugo Durand Atelier Nord 18 member ${invitationId} 2026-11-16T09:15:00.000Z`;
    expect(result).toEqual({ outcome: 'sent' });
    expect(sender.sent).toEqual([
      {
        id: deliveryId,
        to: { address: 'marc.roux@ateliernord.fr', name: '' },
        subject: 'invitation subject',
        html: `<p>${line}</p>`,
        text: line,
        oneClickUnsubscribe: true,
      },
    ]);
    expect(deliveries.deliveries.get(deliveryId)?.status).toBe('sent');
    expect(deliveries.contents.has(deliveryId)).toBe(false);
    expect(unitOfWork.transactions).toBe(1);
  });

  it('does not send twice: a job that runs again finds the e-mail already sent', async () => {
    await useCase.execute({ deliveryId, lastAttempt: false });

    const again: SendInvitationEmailOutput = await useCase.execute({
      deliveryId,
      lastAttempt: false,
    });

    expect(again).toEqual({ outcome: 'already-handled', status: 'sent' });
    expect(sender.sent).toHaveLength(1);
  });

  it('sends nothing for a delivery a later version superseded while its job waited', async () => {
    await deliveries.supersede(invitationId, 2);

    const result: SendInvitationEmailOutput = await useCase.execute({
      deliveryId,
      lastAttempt: false,
    });

    expect(result).toEqual({ outcome: 'already-handled', status: 'skipped' });
    expect(sender.sent).toEqual([]);
  });

  it('skips an invitation that expired while its job waited', async () => {
    clock.instant = new Date('2026-11-16T09:15:00.000Z');

    const result: SendInvitationEmailOutput = await useCase.execute({
      deliveryId,
      lastAttempt: false,
    });

    expect(result).toEqual({ outcome: 'skipped', reason: 'expired' });
    expect(sender.sent).toEqual([]);
    expect(deliveries.deliveries.get(deliveryId)).toMatchObject({
      status: 'skipped',
      skipReason: 'expired',
    });
    expect(deliveries.contents.has(deliveryId)).toBe(false);
  });

  it('leaves the delivery queued when an attempt fails, so the job tries again', async () => {
    sender.failure = new Error('The SMTP server did not accept the e-mail (code ECONNECTION).');

    await expect(useCase.execute({ deliveryId, lastAttempt: false })).rejects.toThrow(
      'ECONNECTION',
    );

    expect(deliveries.deliveries.get(deliveryId)?.status).toBe('queued');
    expect(deliveries.contents.has(deliveryId)).toBe(true);
  });

  it('marks the delivery failed and deletes its content when the last attempt fails', async () => {
    sender.failure = new Error('The SMTP server did not accept the e-mail (reply 550).');

    await expect(useCase.execute({ deliveryId, lastAttempt: true })).rejects.toThrow('550');

    expect(deliveries.deliveries.get(deliveryId)?.status).toBe('failed');
    expect(deliveries.contents.has(deliveryId)).toBe(false);
  });

  it('marks the delivery failed when the e-mail cannot be rendered on the last attempt', async () => {
    const broken: SendInvitationEmail = new SendInvitationEmail(
      unitOfWork,
      deliveries,
      {
        renderInvitationEmail: (): RenderedEmail => {
          throw new Error('"expiryDate" not defined');
        },
      },
      sender,
      clock,
    );

    await expect(broken.execute({ deliveryId, lastAttempt: true })).rejects.toThrow('expiryDate');

    expect(deliveries.deliveries.get(deliveryId)?.status).toBe('failed');
    expect(sender.sent).toEqual([]);
  });

  it('marks failed a queued delivery whose content is gone, without sending', async () => {
    deliveries.contents.clear();

    const result: SendInvitationEmailOutput = await useCase.execute({
      deliveryId,
      lastAttempt: false,
    });

    expect(result).toEqual({ outcome: 'failed' });
    expect(sender.sent).toEqual([]);
    expect(deliveries.deliveries.get(deliveryId)?.status).toBe('failed');
  });

  it('does nothing for a delivery that does not exist in the organization of the job', async () => {
    const result: SendInvitationEmailOutput = await useCase.execute({
      deliveryId: '01938f71-0000-7000-8000-999999999999',
      lastAttempt: true,
    });

    expect(result).toEqual({ outcome: 'missing' });
    expect(sender.sent).toEqual([]);
  });

  it('does not hand the e-mail to the SMTP server once the job gave up on the attempt', async () => {
    const abandoned: AbortController = new AbortController();
    abandoned.abort();

    await expect(
      useCase.execute({ deliveryId, lastAttempt: false, signal: abandoned.signal }),
    ).rejects.toThrow(AttemptAbandonedError);

    expect(sender.sent).toEqual([]);
    expect(deliveries.deliveries.get(deliveryId)?.status).toBe('queued');
  });
});
