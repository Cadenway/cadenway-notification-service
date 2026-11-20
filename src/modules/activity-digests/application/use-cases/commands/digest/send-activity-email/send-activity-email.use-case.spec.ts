import { describe, expect, it, vi } from 'vitest';

import type { ActivityDeliveryDecision } from '../../../../models/digest/activity-delivery-decision.model.js';
import type { ActivityEmailPreferences } from '../../../../models/digest/activity-email-preferences.model.js';
import type { ActivityEmailRecipient } from '../../../../models/digest/activity-email-recipient.model.js';
import type { ActivityDeliveryStore } from '../../../../ports/outbound/transactions/digest/activity-delivery-store.port.js';
import type { ActivityDeliveryUnitOfWork } from '../../../../ports/outbound/transactions/digest/activity-delivery-unit-of-work.port.js';
import { SendActivityEmail } from './send-activity-email.use-case.js';

const recipient: ActivityEmailRecipient = {
  userId: 'ines',
  email: 'ines@example.test',
  language: 'fr',
  timeZone: 'Europe/Paris',
  version: 3,
};

const preferences: ActivityEmailPreferences = {
  version: 2,
  cadence: 'weekly',
  enabled: {
    assignment: true,
    comment: true,
    mention: true,
    'status-change': false,
    approval: false,
    access: false,
  },
};

const permit: ActivityDeliveryDecision = {
  recipientId: 'ines',
  kind: 'mention',
  outcome: 'permitted',
  validUntil: 200,
};

function fixture(clock: () => number = () => 100) {
  const store = {
    lockAttempt: vi.fn<ActivityDeliveryStore['lockAttempt']>(),
    finishAttempt: vi.fn<ActivityDeliveryStore['finishAttempt']>(),
    skipRecipient: vi.fn<ActivityDeliveryStore['skipRecipient']>(),
    listAuthorizationCandidates: vi.fn<ActivityDeliveryStore['listAuthorizationCandidates']>(),
    reserveAuthorizationAttempts: vi.fn<ActivityDeliveryStore['reserveAuthorizationAttempts']>(),
    appendAuthorization: vi.fn<ActivityDeliveryStore['appendAuthorization']>(),
    lockDueOccurrence: vi.fn<ActivityDeliveryStore['lockDueOccurrence']>().mockResolvedValue({
      occurrenceId: 'occurrence',
      generation: 1,
      recipientId: 'ines',
      profileVersion: 3,
      cadence: 'weekly',
    }),
    claim: vi
      .fn<ActivityDeliveryStore['claim']>()
      .mockResolvedValue({ id: 'lease', validUntil: 250 }),
    readPreferences: vi
      .fn<ActivityDeliveryStore['readPreferences']>()
      .mockResolvedValue(preferences),
    listDeliveryDecisions: vi
      .fn<ActivityDeliveryStore['listDeliveryDecisions']>()
      .mockResolvedValue([permit]),
    finish: vi.fn<ActivityDeliveryStore['finish']>().mockResolvedValue(true),
    release: vi.fn<ActivityDeliveryStore['release']>().mockResolvedValue(undefined),
    supersede: vi.fn<ActivityDeliveryStore['supersede']>().mockResolvedValue(true),
    enqueuePlan: vi.fn<ActivityDeliveryStore['enqueuePlan']>().mockResolvedValue(undefined),
  } satisfies ActivityDeliveryStore;
  const work: ActivityDeliveryUnitOfWork = {
    runTenant: vi.fn(),
    runAccount: async (_id, run) => run(store),
  };
  const recipients = {
    findCurrent: vi
      .fn<(id: string) => Promise<ActivityEmailRecipient | null>>()
      .mockResolvedValue(recipient),
  };
  const email = { send: vi.fn().mockResolvedValue(undefined) };
  return {
    useCase: new SendActivityEmail(recipients, work, email, clock),
    store,
    recipients,
    email,
  };
}

describe('SendActivityEmail', () => {
  const input = { userId: 'ines', occurrenceId: 'occurrence', generation: 1 };

  it('sends only a generic count while the current Task permit is valid', async () => {
    const { useCase, store, recipients, email } = fixture();
    expect(await useCase.execute(input)).toBe('sent');
    expect(email.send).toHaveBeenCalledWith(
      expect.objectContaining({ occurrenceId: 'occurrence', count: 1, validUntil: 200 }),
    );
    expect(email.send.mock.calls[0]?.[0]).not.toHaveProperty('items');
    expect(recipients.findCurrent).toHaveBeenCalledTimes(2);
    expect(recipients.findCurrent.mock.invocationCallOrder[1]).toBeGreaterThan(
      store.claim.mock.invocationCallOrder[0] ?? Number.POSITIVE_INFINITY,
    );
    expect(store.finish).toHaveBeenCalledOnce();
  });

  it('never claims or sends an already expired permit', async () => {
    const { useCase, store, email } = fixture();
    store.listDeliveryDecisions.mockResolvedValue([{ ...permit, validUntil: 100 }]);
    expect(await useCase.execute(input)).toBe('pending');
    expect(email.send).not.toHaveBeenCalled();
    expect(store.finish).not.toHaveBeenCalled();
    expect(store.claim).not.toHaveBeenCalled();
  });

  it.each([
    { closes: 'permit', permitUntil: 150, leaseUntil: 200 },
    { closes: 'lease', permitUntil: 200, leaseUntil: 150 },
  ])(
    'releases the claim when the $closes expires during the fresh Identity lookup',
    async ({ permitUntil, leaseUntil }) => {
      let now = 100;
      const { useCase, store, recipients, email } = fixture(() => now);
      store.listDeliveryDecisions.mockResolvedValue([{ ...permit, validUntil: permitUntil }]);
      store.claim.mockResolvedValue({ id: 'lease', validUntil: leaseUntil });
      recipients.findCurrent.mockResolvedValueOnce(recipient).mockImplementationOnce(() => {
        now = 150;
        return Promise.resolve(recipient);
      });

      expect(await useCase.execute(input)).toBe('pending');
      expect(email.send).not.toHaveBeenCalled();
      expect(store.finish).not.toHaveBeenCalled();
      expect(store.release).toHaveBeenCalledExactlyOnceWith('ines', 'occurrence', 1, 'lease');
    },
  );

  it('finishes an empty digest when every authorized decision denies access', async () => {
    const { useCase, store, email } = fixture();
    store.listDeliveryDecisions.mockResolvedValue([{ ...permit, outcome: 'denied' }]);
    expect(await useCase.execute(input)).toBe('empty');
    expect(email.send).not.toHaveBeenCalled();
    expect(store.finish).toHaveBeenCalledOnce();
  });

  it('releases the same occurrence lease when SMTP fails before completion', async () => {
    const { useCase, store, email } = fixture();
    email.send.mockRejectedValueOnce(new Error('SMTP unavailable'));
    await expect(useCase.execute(input)).rejects.toThrow('SMTP unavailable');
    expect(store.finish).not.toHaveBeenCalled();
    expect(store.release).toHaveBeenCalledWith('ines', 'occurrence', 1, 'lease');
  });

  it.each([
    { email: 'new-address@example.test' },
    { version: 4 },
    { timeZone: 'Europe/London' },
    { language: 'en' },
  ])('replans when Identity changes during the claim (%j)', async (change) => {
    const { useCase, store, recipients, email } = fixture();
    let current = recipient;
    recipients.findCurrent.mockImplementation(() => Promise.resolve(current));
    store.claim.mockImplementation(() => {
      current = { ...recipient, ...change };
      return Promise.resolve({ id: 'lease', validUntil: 250 });
    });

    expect(await useCase.execute(input)).toBe('pending');
    expect(email.send).not.toHaveBeenCalled();
    expect(store.finish).not.toHaveBeenCalled();
    expect(store.supersede).toHaveBeenCalledExactlyOnceWith('ines', 'occurrence', 1, 'lease');
    expect(store.enqueuePlan).toHaveBeenCalledExactlyOnceWith('ines', 100);
    expect(store.release).toHaveBeenCalledExactlyOnceWith('ines', 'occurrence', 1, 'lease');
  });

  it('settles the exact claimed generation when Identity no longer has an eligible address', async () => {
    const { useCase, store, recipients, email } = fixture();
    recipients.findCurrent.mockResolvedValueOnce(recipient).mockResolvedValueOnce(null);

    expect(await useCase.execute(input)).toBe('empty');
    expect(email.send).not.toHaveBeenCalled();
    expect(store.finish).toHaveBeenCalledExactlyOnceWith('ines', 'occurrence', 1, 'lease');
    expect(store.enqueuePlan).not.toHaveBeenCalled();
  });

  it('preserves the weekly due date when only the global preference version changed', async () => {
    const { useCase, store } = fixture();
    store.readPreferences.mockResolvedValue({ ...preferences, version: 8 });

    expect(await useCase.execute(input)).toBe('sent');
    expect(store.supersede).not.toHaveBeenCalled();
    expect(store.enqueuePlan).not.toHaveBeenCalled();
  });

  it('preserves a due weekly digest and excludes only currently disabled email kinds', async () => {
    const { useCase, store, email } = fixture();
    store.readPreferences.mockResolvedValue({
      ...preferences,
      version: 8,
      enabled: { ...preferences.enabled, comment: false },
    });
    store.listDeliveryDecisions.mockResolvedValue([
      permit,
      { ...permit, kind: 'comment', outcome: 'pending', validUntil: null },
    ]);

    expect(await useCase.execute(input)).toBe('sent');
    expect(email.send).toHaveBeenCalledWith(expect.objectContaining({ count: 1 }));
    expect(store.supersede).not.toHaveBeenCalled();
    expect(store.enqueuePlan).not.toHaveBeenCalled();
  });

  it('replans an occurrence with a different current cadence before taking a lease', async () => {
    const { useCase, store, email } = fixture();
    store.readPreferences.mockResolvedValue({ ...preferences, cadence: 'daily' });

    expect(await useCase.execute(input)).toBe('pending');
    expect(store.claim).not.toHaveBeenCalled();
    expect(email.send).not.toHaveBeenCalled();
    expect(store.supersede).toHaveBeenCalledExactlyOnceWith('ines', 'occurrence', 1, undefined);
    expect(store.enqueuePlan).toHaveBeenCalledExactlyOnceWith('ines', 100);
  });
});
