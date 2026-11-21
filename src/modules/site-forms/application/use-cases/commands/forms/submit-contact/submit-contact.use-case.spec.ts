import { describe, expect, it, vi } from 'vitest';

import type { ContactSubmissionTransaction } from '../../../../ports/outbound/transactions/forms/contact-submission-transaction.port.js';
import type { ContactSubmissionUnitOfWork } from '../../../../ports/outbound/transactions/forms/contact-submission-unit-of-work.port.js';
import { SubmitContact } from './submit-contact.use-case.js';

const input = {
  idempotencyKey: '806f0650-bdef-4474-a5cf-22b60c810f76',
  email: 'Camille@Example.fr',
  subject: 'login',
  message: 'Je souhaite récupérer l’accès à mon compte.',
};

function setup(
  reservation: Awaited<ReturnType<ContactSubmissionTransaction['reserve']>> = 'new',
  deliveryEnabled = true,
) {
  const reserve = vi.fn<ContactSubmissionTransaction['reserve']>().mockResolvedValue(reservation);
  const save = vi.fn<ContactSubmissionTransaction['save']>().mockResolvedValue('submission-id');
  const enqueueDelivery = vi
    .fn<ContactSubmissionTransaction['enqueueDelivery']>()
    .mockResolvedValue();
  const transaction = { reserve, save, enqueueDelivery };
  const called = vi.fn();
  const work: ContactSubmissionUnitOfWork = {
    run: (callback) => {
      called();
      return callback(transaction);
    },
  };
  return {
    reserve,
    save,
    enqueueDelivery,
    run: called,
    command: new SubmitContact(work, deliveryEnabled),
  };
}

describe('SubmitContact', () => {
  it('reserves the validated original content for 24 hours and enqueues its persisted identifier', async () => {
    const { command, reserve, save, enqueueDelivery, run } = setup();
    await expect(command.execute(input)).resolves.toBe('accepted');
    expect(run).toHaveBeenCalledOnce();
    const [key, submission, retention] = reserve.mock.calls[0] ?? [];
    expect(key).toBe(input.idempotencyKey);
    expect(retention).toBe(86_400_000);
    expect(submission?.replyTo().address()).toBe(input.email);
    expect(submission?.subject()).toBe(input.subject);
    expect(submission?.message()).toBe(input.message);
    expect(save).toHaveBeenCalledExactlyOnceWith(input.idempotencyKey, submission);
    expect(enqueueDelivery).toHaveBeenCalledExactlyOnceWith('submission-id');
    expect(save.mock.invocationCallOrder[0]).toBeLessThan(
      enqueueDelivery.mock.invocationCallOrder[0] ?? 0,
    );
  });

  it.each([
    ['replayed', 'accepted'],
    ['in-progress', 'in-progress'],
    ['key-reused', 'key-reused'],
  ] as const)('returns %s while support delivery is disabled', async (reservation, result) => {
    const { command, save, enqueueDelivery } = setup(reservation, false);
    await expect(command.execute(input)).resolves.toBe(result);
    expect(save).not.toHaveBeenCalled();
    expect(enqueueDelivery).not.toHaveBeenCalled();
  });

  it('rolls back a new reservation before saving contact data while delivery is disabled', async () => {
    const { command, reserve, save, enqueueDelivery } = setup('new', false);
    await expect(command.execute(input)).rejects.toThrow('Contact delivery is unavailable.');
    expect(reserve).toHaveBeenCalledOnce();
    expect(save).not.toHaveBeenCalled();
    expect(enqueueDelivery).not.toHaveBeenCalled();
  });

  it('propagates a queue failure to the transaction owner', async () => {
    const { command, enqueueDelivery } = setup();
    enqueueDelivery.mockRejectedValueOnce(new Error('Queue unavailable'));
    await expect(command.execute(input)).rejects.toThrow('Queue unavailable');
  });

  it('rejects invalid domain content before reserving a key', async () => {
    const { command, run } = setup();
    await expect(command.execute({ ...input, message: 'short' })).rejects.toThrow();
    expect(run).not.toHaveBeenCalled();
  });
});
