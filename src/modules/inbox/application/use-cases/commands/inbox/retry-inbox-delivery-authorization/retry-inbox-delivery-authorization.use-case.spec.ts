import { describe, expect, it, vi } from 'vitest';

import type { InboxAuthorizationAttempt } from '../../../../models/inbox/inbox-authorization-attempt.model.js';
import type { InboxDeliveryStore } from '../../../../ports/outbound/transactions/inbox/inbox-delivery-store.port.js';
import type { InboxDeliveryUnitOfWork } from '../../../../ports/outbound/transactions/inbox/inbox-delivery-unit-of-work.port.js';
import { RetryInboxDeliveryAuthorization } from './retry-inbox-delivery-authorization.use-case.js';

const ORGANIZATION_ID = '019a5f3c-8d2e-7c4a-9b1f-3e5d7a9c1b2f';
const ATTEMPT_ID = '019a7005-6f7a-7b8c-9d0e-1f2a3b4c5d12';
const NEXT_ATTEMPT_ID = '019a7005-6f7a-7b8c-9d0e-1f2a3b4c5d13';
const EXPIRES_AT = 2000;
const CHECK = { organizationId: ORGANIZATION_ID, attemptId: ATTEMPT_ID, retryCount: 1 };
const ATTEMPT: InboxAuthorizationAttempt = {
  id: ATTEMPT_ID,
  expiresAt: EXPIRES_AT,
  outcome: 'pending',
  candidate: {
    organizationId: ORGANIZATION_ID,
    sourceEventId: '019a7005-6f7a-7b8c-9d0e-1f2a3b4c5d10',
    recipientId: '019a5f3c-9e1f-7b2a-8c3d-4e5f6a7b8c31',
    actorUserId: null,
    kind: 'assignment',
    taskKey: 'CAD-482',
    commentId: null,
    status: null,
  },
};

/** Models the store's predecessor check and shows which transaction effects are requested. */
function harness(outcome: InboxAuthorizationAttempt['outcome'], clock = () => EXPIRES_AT) {
  let current = { ...ATTEMPT, outcome };
  const store = {
    stage: vi.fn(),
    lockAttempt: vi.fn<InboxDeliveryStore['lockAttempt']>((organizationId, id) =>
      Promise.resolve(
        current.candidate.organizationId === organizationId && current.id === id ? current : null,
      ),
    ),
    renewAttempt: vi.fn<InboxDeliveryStore['renewAttempt']>((_organizationId, _id, expiresAt) => {
      current = { ...current, id: NEXT_ATTEMPT_ID, expiresAt, outcome: 'pending' };
      return Promise.resolve();
    }),
    newNotificationId: vi.fn(),
    insertNotification: vi.fn(),
    finishAttempt: vi.fn<InboxDeliveryStore['finishAttempt']>((_organizationId, _id, next) => {
      current = { ...current, outcome: next };
      return Promise.resolve();
    }),
  } satisfies InboxDeliveryStore;
  const work: InboxDeliveryUnitOfWork = { run: (_organizationId, execute) => execute(store) };
  return { useCase: new RetryInboxDeliveryAuthorization(work, clock), store };
}

describe('RetryInboxDeliveryAuthorization', () => {
  it.each(['pending', 'expired'] as const)(
    'replaces an elapsed %s correlation once and ignores the old job after replacement',
    async (outcome) => {
      const { useCase, store } = harness(outcome);

      await expect(useCase.execute(CHECK)).resolves.toBe(true);
      await expect(useCase.execute(CHECK)).resolves.toBe(false);
      expect(store.renewAttempt).toHaveBeenCalledExactlyOnceWith(
        ORGANIZATION_ID,
        ATTEMPT_ID,
        EXPIRES_AT + 30_000,
        2,
      );
      expect(store.insertNotification).not.toHaveBeenCalled();
    },
  );

  it.each(['permitted', 'denied'] as const)(
    'keeps a %s decision terminal after the deadline',
    async (outcome) => {
      const { useCase, store } = harness(outcome);

      await expect(useCase.execute(CHECK)).resolves.toBe(false);
      expect(store.renewAttempt).not.toHaveBeenCalled();
      expect(store.finishAttempt).not.toHaveBeenCalled();
    },
  );

  it('sends an early job back for retry without changing the correlation', async () => {
    const { useCase, store } = harness('pending', () => EXPIRES_AT - 1);

    await expect(useCase.execute(CHECK)).rejects.toThrow('deadline has not elapsed');
    expect(store.renewAttempt).not.toHaveBeenCalled();
    expect(store.finishAttempt).not.toHaveBeenCalled();
  });

  it('expires the tenth pending attempt without creating an eleventh request', async () => {
    const { useCase, store } = harness('pending');
    const finalCheck = { ...CHECK, retryCount: 10 };

    await expect(useCase.execute(finalCheck)).resolves.toBe(false);
    await expect(useCase.execute(finalCheck)).resolves.toBe(false);
    expect(store.finishAttempt).toHaveBeenCalledExactlyOnceWith(
      ORGANIZATION_ID,
      ATTEMPT_ID,
      'expired',
    );
    expect(store.renewAttempt).not.toHaveBeenCalled();
  });

  it('cannot renew a correlation from another organization', async () => {
    const { useCase, store } = harness('pending');

    await expect(
      useCase.execute({ ...CHECK, organizationId: '019a5f3c-8d2e-7c4a-9b1f-3e5d7a9c1b30' }),
    ).resolves.toBe(false);
    expect(store.renewAttempt).not.toHaveBeenCalled();
    expect(store.finishAttempt).not.toHaveBeenCalled();
  });

  it.each([0, 11, 1.5])('rejects invalid attempt count %i before locking', (retryCount) => {
    const { useCase, store } = harness('pending');
    expect(() => useCase.execute({ ...CHECK, retryCount })).toThrow(RangeError);
    expect(store.lockAttempt).not.toHaveBeenCalled();
  });

  it('rejects the transaction if the replacement deadline elapses while staging', async () => {
    const clock = vi.fn<() => number>().mockReturnValueOnce(EXPIRES_AT);
    clock.mockReturnValue(EXPIRES_AT + 30_000);
    const { useCase } = harness('pending', clock);

    await expect(useCase.execute(CHECK)).rejects.toThrow('elapsed while staging');
  });
});
