import { describe, expect, it, vi } from 'vitest';

import type { InboxDeliveryStore } from '../../../../ports/outbound/transactions/inbox/inbox-delivery-store.port.js';
import type { InboxDeliveryUnitOfWork } from '../../../../ports/outbound/transactions/inbox/inbox-delivery-unit-of-work.port.js';
import type { StageInboxDeliveriesInput } from './stage-inbox-deliveries.input.js';
import { StageInboxDeliveries } from './stage-inbox-deliveries.use-case.js';

const LAURE = '019a5f3c-8d2e-7c4a-9b1f-3e5d7a9c1b30';
const CAMILLE = '019a5f3c-9e1f-7b2a-8c3d-4e5f6a7b8c31';
const LEA = '019a5f3c-9e1f-7b2a-8c3d-4e5f6a7b8c32';
const SOURCE: StageInboxDeliveriesInput['source'] = {
  organizationId: '019a5f3c-8d2e-7c4a-9b1f-3e5d7a9c1b2f',
  sourceEventId: '019a7005-6f7a-7b8c-9d0e-1f2a3b4c5d10',
  actorUserId: LAURE,
  taskKey: 'CAD-482',
  commentId: '019a7005-6f7a-7b8c-9d0e-1f2a3b4c5d11',
  status: null,
};

/** Exercises audience selection with a single transaction sink. */
function harness(clock: () => number = () => 1000) {
  const store = {
    stage: vi.fn<InboxDeliveryStore['stage']>().mockResolvedValue(2),
    lockAttempt: vi.fn(),
    renewAttempt: vi.fn(),
    newNotificationId: vi.fn(),
    insertNotification: vi.fn(),
    finishAttempt: vi.fn(),
  } satisfies InboxDeliveryStore;
  const opened = vi.fn();
  const work: InboxDeliveryUnitOfWork = {
    run: (organizationId, execute) => {
      opened(organizationId);
      return execute(store);
    },
  };
  return { useCase: new StageInboxDeliveries(work, clock), opened, stage: store.stage };
}

describe('StageInboxDeliveries', () => {
  it('stages one candidate per recipient, prioritizes mentions and omits the author', async () => {
    const { useCase, opened, stage } = harness();

    await expect(
      useCase.execute({
        source: SOURCE,
        audiences: [
          { kind: 'mention', recipientIds: [LAURE.toUpperCase(), CAMILLE.toUpperCase()] },
          { kind: 'comment', recipientIds: [CAMILLE, LEA, LEA] },
        ],
        expiresAt: 2000,
      }),
    ).resolves.toBe(2);

    expect(opened).toHaveBeenCalledExactlyOnceWith(SOURCE.organizationId);
    expect(stage).toHaveBeenCalledExactlyOnceWith(
      [
        { ...SOURCE, kind: 'mention', recipientId: CAMILLE },
        { ...SOURCE, kind: 'comment', recipientId: LEA },
      ],
      2000,
    );
  });

  it('opens no transaction when the source audience contains only the author', async () => {
    const { useCase, opened, stage } = harness();

    await expect(
      useCase.execute({
        source: SOURCE,
        audiences: [{ kind: 'comment', recipientIds: [LAURE] }],
        expiresAt: 2000,
      }),
    ).resolves.toBe(0);

    expect(opened).not.toHaveBeenCalled();
    expect(stage).not.toHaveBeenCalled();
  });

  it('refuses an attempt whose exclusive deadline already elapsed', () => {
    const { useCase, opened } = harness();

    expect(() =>
      useCase.execute({
        source: SOURCE,
        audiences: [{ kind: 'mention', recipientIds: [CAMILLE] }],
        expiresAt: 1000,
      }),
    ).toThrow(RangeError);

    expect(opened).not.toHaveBeenCalled();
  });

  it('rejects the transaction if the exclusive deadline elapses while requests are staged', async () => {
    const clock = vi.fn<() => number>().mockReturnValueOnce(1000).mockReturnValueOnce(1000);
    clock.mockReturnValue(2000);
    const { stage, useCase } = harness(clock);

    await expect(
      useCase.execute({
        source: SOURCE,
        audiences: [{ kind: 'mention', recipientIds: [CAMILLE] }],
        expiresAt: 2000,
      }),
    ).rejects.toThrow('Inbox authorization expiry elapsed while staging.');
    expect(stage).toHaveBeenCalledOnce();
  });
});
