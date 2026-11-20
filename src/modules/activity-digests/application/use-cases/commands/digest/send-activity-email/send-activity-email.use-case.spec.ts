import { describe, expect, it, vi } from 'vitest';

import type { ActivityEmailDelivery } from '../../../../models/digest/activity-email-delivery.model.js';
import type { ActivityDeliveryStore } from '../../../../ports/outbound/transactions/digest/activity-delivery-store.port.js';
import type { ActivityDeliveryUnitOfWork } from '../../../../ports/outbound/transactions/digest/activity-delivery-unit-of-work.port.js';
import { SendActivityEmail } from './send-activity-email.use-case.js';

function fixture(decision: 'permit' | 'deny' = 'permit', validUntil = 200) {
  const delivery: ActivityEmailDelivery = {
    occurrenceId: 'occurrence',
    generation: 1,
    leaseId: 'lease',
    recipientId: 'ines',
    profileVersion: 3,
    preferencesVersion: 2,
    items: [
      {
        candidate: {
          organizationId: 'atelier',
          sourceEventId: 'source',
          recipientId: 'ines',
          actorUserId: null,
          kind: 'mention',
          taskKey: 'CAD-482',
          commentId: null,
          status: null,
        },
        decision,
        validUntil,
      },
    ],
  };
  const finish = vi.fn().mockResolvedValue(true);
  const release = vi.fn().mockResolvedValue(undefined);
  const store = {
    leaseAuthorized: vi.fn().mockResolvedValue(delivery),
    finish,
    release,
  } as unknown as ActivityDeliveryStore;
  const work: ActivityDeliveryUnitOfWork = {
    runTenant: vi.fn(),
    runAccount: async (_id, run) => run(store),
  };
  const recipients = {
    findCurrent: vi.fn().mockResolvedValue({
      userId: 'ines',
      email: 'ines@example.test',
      language: 'fr',
      timeZone: 'Europe/Paris',
      version: 3,
    }),
  };
  const email = { send: vi.fn().mockResolvedValue(undefined) };
  return {
    useCase: new SendActivityEmail(recipients, work, email, () => 100),
    finish,
    release,
    email,
  };
}

describe('SendActivityEmail', () => {
  const input = { userId: 'ines', occurrenceId: 'occurrence', generation: 1 };

  it('sends only a generic count while the current Task permit is valid', async () => {
    const { useCase, finish, email } = fixture();
    expect(await useCase.execute(input)).toBe('sent');
    expect(email.send).toHaveBeenCalledWith(
      expect.objectContaining({ occurrenceId: 'occurrence', count: 1, validUntil: 200 }),
    );
    expect(email.send.mock.calls[0]?.[0]).not.toHaveProperty('items');
    expect(finish).toHaveBeenCalledOnce();
  });

  it('never sends an expired permit and releases its lease for retry', async () => {
    const { useCase, finish, release, email } = fixture('permit', 100);
    expect(await useCase.execute(input)).toBe('pending');
    expect(email.send).not.toHaveBeenCalled();
    expect(finish).not.toHaveBeenCalled();
    expect(release).toHaveBeenCalledOnce();
  });

  it('finishes an empty digest when every authorized decision denies access', async () => {
    const { useCase, finish, email } = fixture('deny');
    expect(await useCase.execute(input)).toBe('empty');
    expect(email.send).not.toHaveBeenCalled();
    expect(finish).toHaveBeenCalledOnce();
  });

  it('releases the same occurrence lease when SMTP fails before completion', async () => {
    const { useCase, finish, release, email } = fixture();
    email.send.mockRejectedValueOnce(new Error('SMTP unavailable'));
    await expect(useCase.execute(input)).rejects.toThrow('SMTP unavailable');
    expect(finish).not.toHaveBeenCalled();
    expect(release).toHaveBeenCalledWith('ines', 'occurrence', 1, 'lease');
  });
});
