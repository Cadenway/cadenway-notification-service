import { describe, expect, it, vi } from 'vitest';

import { ContactSubmission } from '../../../../../domain/value-objects/forms/contact-submission.value-object.js';
import { DeliverContact } from './deliver-contact.use-case.js';

const submissionId = '01938f6e-0000-7000-8000-000000000001';
const supportAddress = 'support@cadenway.fr';
const visitor = {
  email: 'camille.martin@ateliernord.fr',
  subject: 'login',
  message: 'Je souhaite récupérer l’accès à mon compte.',
};

function setup(address: string | null = supportAddress) {
  const submission = ContactSubmission.of(visitor);
  const loadPending = vi.fn().mockResolvedValue(submission);
  const settlePending = vi.fn().mockResolvedValue(undefined);
  const send = vi.fn().mockResolvedValue(undefined);
  const command = new DeliverContact(
    { loadPending, settlePending },
    { send },
    address ?? undefined,
  );
  const controller = new AbortController();
  return {
    command,
    controller,
    loadPending,
    settlePending,
    send,
    input: { submissionId, lastAttempt: false, signal: controller.signal },
  };
}

describe('Contact delivery', () => {
  it('sends the accepted message to the configured support mailbox and settles it once', async () => {
    const { command, input, loadPending, send, settlePending } = setup();

    await command.execute(input);

    expect(loadPending).toHaveBeenCalledExactlyOnceWith(submissionId);
    expect(send).toHaveBeenCalledExactlyOnceWith({
      submissionId,
      supportAddress,
      replyTo: visitor.email,
      subject: visitor.subject,
      message: visitor.message,
    });
    expect(settlePending).toHaveBeenCalledExactlyOnceWith(submissionId, 'sent');
  });

  it('does not send or settle again when the submission is already settled or absent', async () => {
    const { command, input, loadPending, send, settlePending } = setup();
    loadPending.mockResolvedValueOnce(null);

    await command.execute(input);

    expect(send).not.toHaveBeenCalled();
    expect(settlePending).not.toHaveBeenCalled();
  });

  it('keeps the submission pending when an early SMTP attempt fails', async () => {
    const { command, input, send, settlePending } = setup();
    send.mockRejectedValueOnce(new Error('recipient@example.fr private content'));

    await expect(command.execute(input)).rejects.not.toThrow('recipient@example.fr');
    expect(settlePending).not.toHaveBeenCalled();
  });

  it('marks the submission failed on the final SMTP failure', async () => {
    const { command, input, send, settlePending } = setup();
    send.mockRejectedValueOnce(new Error('SMTP failure'));

    await expect(command.execute({ ...input, lastAttempt: true })).rejects.toThrow();
    expect(settlePending).toHaveBeenCalledExactlyOnceWith(submissionId, 'failed');
  });

  it('retries without sending when the configured support mailbox is unavailable', async () => {
    const { command, input, send, settlePending } = setup(null);

    await expect(command.execute(input)).rejects.toThrow();
    expect(send).not.toHaveBeenCalled();
    expect(settlePending).not.toHaveBeenCalled();
  });

  it('marks the submission failed if the support mailbox remains unavailable on the final attempt', async () => {
    const { command, input, send, settlePending } = setup(null);

    await expect(command.execute({ ...input, lastAttempt: true })).rejects.toThrow();
    expect(send).not.toHaveBeenCalled();
    expect(settlePending).toHaveBeenCalledExactlyOnceWith(submissionId, 'failed');
  });

  it('does not start SMTP when the attempt expires during the pending-submission read', async () => {
    const { command, input, controller, loadPending, send } = setup();
    loadPending.mockImplementationOnce(() => {
      controller.abort();
      return Promise.resolve(ContactSubmission.of(visitor));
    });

    await expect(command.execute(input)).rejects.toThrow();
    expect(send).not.toHaveBeenCalled();
  });

  it('records successful delivery when SMTP accepts after the attempt signal expires', async () => {
    const { command, input, controller, send, settlePending } = setup();
    send.mockImplementationOnce(() => {
      controller.abort();
      return Promise.resolve();
    });

    await command.execute(input);

    expect(settlePending).toHaveBeenCalledExactlyOnceWith(submissionId, 'sent');
  });
});
