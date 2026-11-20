import { describe, expect, it, vi } from 'vitest';

import type { InboxAuthorizationAttempt } from '../../../../models/inbox/inbox-authorization-attempt.model.js';
import type { InboxDeliveryStore } from '../../../../ports/outbound/transactions/inbox/inbox-delivery-store.port.js';
import type { InboxDeliveryUnitOfWork } from '../../../../ports/outbound/transactions/inbox/inbox-delivery-unit-of-work.port.js';
import type { AcceptInboxDeliveryAuthorizationInput } from './accept-inbox-delivery-authorization.input.js';
import { AcceptInboxDeliveryAuthorization } from './accept-inbox-delivery-authorization.use-case.js';

const ATTEMPT: InboxAuthorizationAttempt = {
  id: '019a7005-6f7a-7b8c-9d0e-1f2a3b4c5d12',
  outcome: 'pending',
  expiresAt: 2000,
  candidate: {
    organizationId: '019a5f3c-8d2e-7c4a-9b1f-3e5d7a9c1b2f',
    sourceEventId: '019a7005-6f7a-7b8c-9d0e-1f2a3b4c5d10',
    recipientId: '019a5f3c-9e1f-7b2a-8c3d-4e5f6a7b8c31',
    actorUserId: '019a5f3c-8d2e-7c4a-9b1f-3e5d7a9c1b30',
    kind: 'mention',
    taskKey: 'CAD-482',
    commentId: '019a7005-6f7a-7b8c-9d0e-1f2a3b4c5d11',
    status: null,
  },
};
const PERMIT: AcceptInboxDeliveryAuthorizationInput = {
  organizationId: ATTEMPT.candidate.organizationId,
  attemptId: ATTEMPT.id,
  decision: 'permit',
  decidedAt: 1200,
  validUntil: 1800,
};
const NOTIFICATION_ID = '019a7005-6f7a-7b8c-9d0e-1f2a3b4c5d13';

/** Shares scoped attempt and inbox operations through one work callback. */
function harness(clock: () => number = () => 1500, inAppEnabled = true) {
  let attempt = ATTEMPT;
  const store = {
    stage: vi.fn(),
    renewAttempt: vi.fn(),
    lockAttempt: vi.fn<InboxDeliveryStore['lockAttempt']>((org, id) =>
      Promise.resolve(
        org === attempt.candidate.organizationId && id === attempt.id ? attempt : null,
      ),
    ),
    newNotificationId: vi
      .fn<InboxDeliveryStore['newNotificationId']>()
      .mockResolvedValue(NOTIFICATION_ID),
    insertNotification: vi.fn<InboxDeliveryStore['insertNotification']>().mockResolvedValue(true),
    finishAttempt: vi.fn<InboxDeliveryStore['finishAttempt']>((_org, _id, outcome) => {
      attempt = { ...attempt, outcome };
      return Promise.resolve();
    }),
  } satisfies InboxDeliveryStore;
  const work: InboxDeliveryUnitOfWork = { run: (_organizationId, execute) => execute(store) };
  const enabled = vi.fn(() => Promise.resolve(inAppEnabled));
  return { useCase: new AcceptInboxDeliveryAuthorization(work, clock, enabled), store, enabled };
}

describe('AcceptInboxDeliveryAuthorization', () => {
  it('settles the Task permit without creating an Inbox effect when in-app is disabled', async () => {
    const { useCase, store, enabled } = harness(() => 1500, false);

    await expect(useCase.execute(PERMIT)).resolves.toBe(false);
    expect(enabled).toHaveBeenCalledExactlyOnceWith(ATTEMPT.candidate.recipientId, 'mention');
    expect(store.newNotificationId).not.toHaveBeenCalled();
    expect(store.insertNotification).not.toHaveBeenCalled();
    expect(store.finishAttempt).toHaveBeenCalledExactlyOnceWith(
      PERMIT.organizationId,
      ATTEMPT.id,
      'permitted',
    );
  });

  it('creates one notification with the locked recipient binding across repeated permits', async () => {
    const { useCase, store } = harness();

    await expect(useCase.execute(PERMIT)).resolves.toBe(true);
    await expect(useCase.execute(PERMIT)).resolves.toBe(false);

    expect(store.finishAttempt).toHaveBeenCalledExactlyOnceWith(
      PERMIT.organizationId,
      ATTEMPT.id,
      'permitted',
    );
    expect(store.insertNotification).toHaveBeenCalledTimes(1);
    const [inserted] = store.insertNotification.mock.calls;
    expect(inserted?.[0]).toEqual(ATTEMPT.candidate);
    expect(inserted?.[1].snapshot).toMatchObject({
      id: NOTIFICATION_ID,
      recipientId: ATTEMPT.candidate.recipientId,
      version: 1,
      createdAt: 1500,
    });
    expect(inserted?.[2]).toEqual({
      notificationId: NOTIFICATION_ID,
      organizationId: PERMIT.organizationId,
      recipientId: ATTEMPT.candidate.recipientId,
      createdAt: 1500,
    });
  });

  it('does not consume an attempt in the wrong organization', async () => {
    const { useCase, store } = harness();

    await expect(
      useCase.execute({
        ...PERMIT,
        organizationId: '019a5f3c-8d2e-7c4a-9b1f-3e5d7a9c1b33',
      }),
    ).resolves.toBe(false);

    expect(store.insertNotification).not.toHaveBeenCalled();
    expect(store.finishAttempt).not.toHaveBeenCalled();
  });

  it('makes denial terminal without recording a notification', async () => {
    const { useCase, store } = harness();

    await expect(useCase.execute({ ...PERMIT, decision: 'deny' })).resolves.toBe(false);
    await expect(useCase.execute(PERMIT)).resolves.toBe(false);

    expect(store.finishAttempt).toHaveBeenCalledExactlyOnceWith(
      PERMIT.organizationId,
      ATTEMPT.id,
      'denied',
    );
    expect(store.insertNotification).not.toHaveBeenCalled();
  });

  it('expires the attempt at its exclusive deadline', async () => {
    const { useCase, store } = harness(() => ATTEMPT.expiresAt);

    await expect(useCase.execute(PERMIT)).resolves.toBe(false);

    expect(store.finishAttempt).toHaveBeenCalledExactlyOnceWith(
      PERMIT.organizationId,
      ATTEMPT.id,
      'expired',
    );
    expect(store.insertNotification).not.toHaveBeenCalled();
  });

  it.each([
    { validUntil: 1500, decidedAt: 1200 },
    { validUntil: 2001, decidedAt: 1200 },
    { validUntil: 1800, decidedAt: 1800 },
  ])('withholds delivery for a decision outside its permitted time window', async (decision) => {
    const { useCase, store } = harness();

    await expect(useCase.execute({ ...PERMIT, ...decision })).resolves.toBe(false);

    expect(store.insertNotification).not.toHaveBeenCalled();
    expect(store.finishAttempt).not.toHaveBeenCalled();
  });

  it('rejects the entire transaction if the deadline elapses during the write', async () => {
    const clock = vi
      .fn<() => number>()
      .mockReturnValueOnce(1500)
      .mockReturnValueOnce(1500)
      .mockReturnValue(1800);
    const { useCase } = harness(clock);

    await expect(useCase.execute(PERMIT)).rejects.toThrow('Inbox authorization expired');
  });

  it('keeps an attempt open if the deadline elapses during the preference read', async () => {
    const clock = vi.fn<() => number>().mockReturnValueOnce(1500).mockReturnValue(1800);
    const { useCase, store } = harness(clock, false);

    await expect(useCase.execute(PERMIT)).rejects.toThrow('Inbox authorization expired');
    expect(store.finishAttempt).not.toHaveBeenCalled();
    expect(store.insertNotification).not.toHaveBeenCalled();
  });
});
