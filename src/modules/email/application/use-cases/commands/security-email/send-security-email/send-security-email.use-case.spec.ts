import { beforeEach, describe, expect, it } from 'vitest';
import { ResetLinkToken } from '../../../../../domain/value-objects/security-email/reset-link-token.value-object.js';
import { SendWindow } from '../../../../../domain/value-objects/security-email/send-window.value-object.js';
import { AttemptAbandonedError } from '../../../../models/code-email/attempt-abandoned-error.model.js';
import type { RenderedEmail } from '../../../../models/code-email/rendered-email.model.js';
import type { SecurityEmailMessage } from '../../../../models/security-email/security-email-message.model.js';
import {
  FixedClock,
  ImmediateUnitOfWork,
  RecordingEmailSender,
} from '../../../../ports/outbound/persistence/code-email/code-email-deliveries.port.fixture.js';
import { InMemorySecurityEmailDeliveries } from '../../../../ports/outbound/persistence/security-email/security-email-deliveries.port.fixture.js';
import type { SecurityEmailRenderer } from '../../../../ports/outbound/templates/security-email/security-email-renderer.port.js';
import type { SendSecurityEmailOutput } from './send-security-email.output.js';
import { SendSecurityEmail } from './send-security-email.use-case.js';

/**
 * Class EchoRenderer
 *
 * @description
 * `SecurityEmailRenderer` that keeps what it was asked to render, to check what the use case
 * passes.
 */
class EchoRenderer implements SecurityEmailRenderer {
  // #region Properties
  /**
   * Property messages
   *
   * @description
   * The messages rendered, in order.
   *
   * @type {SecurityEmailMessage[]}
   * @readonly
   */
  public readonly messages: SecurityEmailMessage[] = [];
  // #endregion

  // #region Methods
  /**
   * Method renderSecurityEmail
   *
   * @description
   * Renders the message as plain fields.
   *
   * @param {SecurityEmailMessage} message - The message.
   * @returns {RenderedEmail} A minimal e-mail.
   */
  public renderSecurityEmail(message: SecurityEmailMessage): RenderedEmail {
    this.messages.push(message);
    return {
      subject: `${message.details.template} subject`,
      html: `<p>${String(message.validityMinutes)}</p>`,
      text: String(message.validityMinutes),
    };
  }
  // #endregion
}

describe('SendSecurityEmail', () => {
  let deliveries: InMemorySecurityEmailDeliveries;
  let renderer: EchoRenderer;
  let sender: RecordingEmailSender;
  let clock: FixedClock;
  let unitOfWork: ImmediateUnitOfWork;
  let useCase: SendSecurityEmail;
  let deliveryId: string;

  beforeEach(async () => {
    deliveries = new InMemorySecurityEmailDeliveries();
    renderer = new EchoRenderer();
    sender = new RecordingEmailSender();
    clock = new FixedClock(new Date('2026-11-09T13:10:02.000Z'));
    unitOfWork = new ImmediateUnitOfWork();
    useCase = new SendSecurityEmail(unitOfWork, deliveries, renderer, sender, clock);
    deliveryId =
      (await deliveries.record(
        {
          eventId: '019a6b44-0a1b-7c2d-8e3f-4a5b6c7d8e06',
          userId: '019a5f3c-8d2e-7c4a-9b1f-3e5d7a9c1b30',
          template: 'password-reset',
          language: 'en',
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

  it('sends a queued e-mail without unsubscription, then marks it sent and deletes its content', async () => {
    const result: SendSecurityEmailOutput = await useCase.execute({
      deliveryId,
      lastAttempt: false,
    });

    expect(result).toEqual({ outcome: 'sent', template: 'password-reset' });
    expect(sender.sent).toEqual([
      {
        id: deliveryId,
        to: { address: 'camille.martin@ateliernord.fr', name: 'Camille Martin' },
        subject: 'password-reset subject',
        html: '<p>30</p>',
        text: '30',
        unsubscribe: false,
      },
    ]);
    expect(renderer.messages).toMatchObject([
      {
        recipientEmail: 'camille.martin@ateliernord.fr',
        occurredAt: new Date('2026-11-09T13:10:00.000Z'),
        validityMinutes: 30,
        timeZone: 'Europe/Paris',
        details: { template: 'password-reset' },
      },
    ]);
    expect(deliveries.deliveries.get(deliveryId)?.status).toBe('sent');
    expect(deliveries.contents.has(deliveryId)).toBe(false);
  });

  it('does not send twice: a job that runs again finds the e-mail already sent', async () => {
    await useCase.execute({ deliveryId, lastAttempt: false });

    const again: SendSecurityEmailOutput = await useCase.execute({
      deliveryId,
      lastAttempt: false,
    });

    expect(again).toEqual({ outcome: 'already-handled', status: 'sent' });
    expect(sender.sent).toHaveLength(1);
  });

  it('skips a reset link that stopped working while its job waited, and deletes its token', async () => {
    clock.instant = new Date('2026-11-09T13:40:00.000Z');

    const result: SendSecurityEmailOutput = await useCase.execute({
      deliveryId,
      lastAttempt: false,
    });

    expect(result).toEqual({ outcome: 'skipped', reason: 'expired' });
    expect(sender.sent).toEqual([]);
    expect(deliveries.deliveries.get(deliveryId)?.status).toBe('skipped');
    expect(deliveries.contents.has(deliveryId)).toBe(false);
  });

  it('leaves the delivery queued when an attempt fails, so the job tries again', async () => {
    sender.failure = new Error('The SMTP server did not accept the e-mail (reply 451).');

    await expect(useCase.execute({ deliveryId, lastAttempt: false })).rejects.toThrow('451');

    expect(deliveries.deliveries.get(deliveryId)?.status).toBe('queued');
    expect(deliveries.contents.has(deliveryId)).toBe(true);
  });

  it('marks the delivery failed and deletes its token when the last attempt fails', async () => {
    sender.failure = new Error('The SMTP server did not accept the e-mail (reply 550).');

    await expect(useCase.execute({ deliveryId, lastAttempt: true })).rejects.toThrow('550');

    expect(deliveries.deliveries.get(deliveryId)?.status).toBe('failed');
    expect(deliveries.contents.has(deliveryId)).toBe(false);
  });

  it('marks failed a queued delivery whose content is gone, without sending', async () => {
    deliveries.contents.delete(deliveryId);

    expect(await useCase.execute({ deliveryId, lastAttempt: false })).toEqual({
      outcome: 'failed',
    });
    expect(sender.sent).toEqual([]);
  });

  it('does nothing for a delivery that does not exist', async () => {
    expect(
      await useCase.execute({
        deliveryId: '01938f6e-0000-7000-9000-999999999999',
        lastAttempt: false,
      }),
    ).toEqual({ outcome: 'missing' });
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
