import { beforeEach, describe, expect, it } from 'vitest';
import type { CodeEmailMessage } from '../../../../models/code-email/code-email-message.model.js';
import type { EmailRenderer } from '../../../../ports/outbound/templates/code-email/email-renderer.port.js';
import type { RenderedEmail } from '../../../../models/code-email/rendered-email.model.js';
import { CodeValidity } from '../../../../../domain/value-objects/code-email/code-validity.value-object.js';
import { OneTimeCode } from '../../../../../domain/value-objects/code-email/one-time-code.value-object.js';
import {
  FixedClock,
  ImmediateUnitOfWork,
  InMemoryCodeEmailDeliveries,
  RecordingEmailSender,
} from '../../../../ports/outbound/persistence/code-email/code-email-deliveries.port.fixture.js';
import { AttemptAbandonedError } from '../../../../models/code-email/attempt-abandoned-error.model.js';
import { SendCodeEmail } from './send-code-email.use-case.js';
import type { SendCodeEmailOutput } from './send-code-email.output.js';

/**
 * Class EchoRenderer
 *
 * @description
 * `EmailRenderer` that writes what it was asked to render, to check what the use case passes.
 */
class EchoRenderer implements EmailRenderer {
  // #region Methods
  /**
   * Method renderCodeEmail
   *
   * @description
   * Renders the message as plain fields.
   *
   * @param {CodeEmailMessage} message - The message.
   * @returns {RenderedEmail} A minimal e-mail.
   */
  public renderCodeEmail(message: CodeEmailMessage): RenderedEmail {
    return {
      subject: `${message.template} subject`,
      html: `<p>${message.recipientName} ${message.code.display()} ${String(message.validityMinutes)}</p>`,
      text: `${message.recipientName} ${message.code.display()} ${String(message.validityMinutes)}`,
    };
  }
  // #endregion
}

describe('SendCodeEmail', () => {
  let deliveries: InMemoryCodeEmailDeliveries;
  let sender: RecordingEmailSender;
  let clock: FixedClock;
  let unitOfWork: ImmediateUnitOfWork;
  let useCase: SendCodeEmail;
  let deliveryId: string;

  beforeEach(async () => {
    deliveries = new InMemoryCodeEmailDeliveries();
    sender = new RecordingEmailSender();
    clock = new FixedClock(new Date('2026-11-09T13:07:02.000Z'));
    unitOfWork = new ImmediateUnitOfWork();
    useCase = new SendCodeEmail(unitOfWork, deliveries, new EchoRenderer(), sender, clock);
    deliveryId =
      (await deliveries.record(
        {
          eventId: '01938f6f-1a2b-7c3d-8e4f-5a6b7c8d9e01',
          codeId: '01938f6f-1a2b-7c3d-8e4f-5a6b7c8d9e02',
          userId: '01938f6e-8a42-7d5b-b2c9-5e1f3a6d9c24',
          purpose: 'email-verification',
          language: 'fr',
          validity: CodeValidity.between(
            new Date('2026-11-09T13:07:00.000Z'),
            new Date('2026-11-09T13:17:00.000Z'),
          ),
          skipReason: null,
        },
        {
          code: OneTimeCode.of('482913'),
          recipientEmail: 'camille.martin@ateliernord.fr',
          recipientName: 'Camille Martin',
        },
      )) ?? '';
  });

  it('sends a queued e-mail as a security e-mail, then marks it sent and deletes its content', async () => {
    const result: SendCodeEmailOutput = await useCase.execute({ deliveryId, lastAttempt: false });

    expect(result).toEqual({ outcome: 'sent', template: 'email-verification' });
    expect(sender.sent).toEqual([
      {
        id: deliveryId,
        to: { address: 'camille.martin@ateliernord.fr', name: 'Camille Martin' },
        subject: 'email-verification subject',
        html: '<p>Camille Martin 482 913 10</p>',
        text: 'Camille Martin 482 913 10',
        unsubscribe: false,
      },
    ]);
    expect(deliveries.deliveries.get(deliveryId)?.status).toBe('sent');
    expect(deliveries.contents.has(deliveryId)).toBe(false);
  });

  it('does not send twice: a job that runs again finds the e-mail already sent', async () => {
    await useCase.execute({ deliveryId, lastAttempt: false });

    const again: SendCodeEmailOutput = await useCase.execute({ deliveryId, lastAttempt: false });

    expect(again).toEqual({ outcome: 'already-handled', status: 'sent' });
    expect(sender.sent).toHaveLength(1);
  });

  it('skips a code that expired while its job waited', async () => {
    clock.instant = new Date('2026-11-09T13:17:00.000Z');

    const result: SendCodeEmailOutput = await useCase.execute({ deliveryId, lastAttempt: false });

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

  it('marks failed a queued delivery whose content is gone, without sending', async () => {
    deliveries.contents.clear();

    const result: SendCodeEmailOutput = await useCase.execute({ deliveryId, lastAttempt: false });

    expect(result).toEqual({ outcome: 'failed' });
    expect(sender.sent).toEqual([]);
    expect(deliveries.deliveries.get(deliveryId)?.status).toBe('failed');
  });

  it('does nothing for a delivery that does not exist', async () => {
    const result: SendCodeEmailOutput = await useCase.execute({
      deliveryId: '01938f6e-0000-7000-8000-999999999999',
      lastAttempt: true,
    });

    expect(result).toEqual({ outcome: 'missing' });
    expect(sender.sent).toEqual([]);
  });

  it('marks each change of the delivery in a transaction of its own unit of work', async () => {
    await useCase.execute({ deliveryId, lastAttempt: false });

    expect(unitOfWork.transactions).toBe(1);
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

  it('marks the delivery failed when the e-mail cannot be rendered on the last attempt', async () => {
    const broken: SendCodeEmail = new SendCodeEmail(
      unitOfWork,
      deliveries,
      {
        renderCodeEmail: (): RenderedEmail => {
          throw new Error('"validityMinutes" not defined');
        },
      },
      sender,
      clock,
    );

    await expect(broken.execute({ deliveryId, lastAttempt: true })).rejects.toThrow(
      'validityMinutes',
    );

    expect(deliveries.deliveries.get(deliveryId)?.status).toBe('failed');
    expect(deliveries.contents.has(deliveryId)).toBe(false);
  });
});
