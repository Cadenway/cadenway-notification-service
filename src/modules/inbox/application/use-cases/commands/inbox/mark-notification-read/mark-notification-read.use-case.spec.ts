import { describe, expect, it, vi } from 'vitest';

import { InboxNotification } from '../../../../../domain/aggregates/inbox/inbox-notification.aggregate.js';
import type { InboxStore } from '../../../../ports/outbound/transactions/inbox/inbox-store.port.js';
import type { InboxUnitOfWork } from '../../../../ports/outbound/transactions/inbox/inbox-unit-of-work.port.js';
import { MarkNotificationRead } from './mark-notification-read.use-case.js';

const item = InboxNotification.create({
  id: 'notification',
  organizationId: 'atelier',
  recipientId: 'camille',
  kind: 'mention',
  actorUserId: 'lea',
  subject: { kind: 'task', id: 'task' },
  createdAt: 1000,
}).notification;
const input = {
  organizationId: 'atelier',
  userId: 'camille',
  id: 'notification',
  expectedVersion: 1,
  now: 2000,
};

function fixture(visibility: 'visible' | 'hidden' | 'unavailable') {
  const store = {
    find: vi.fn().mockResolvedValue(item),
    visibility: vi.fn().mockResolvedValue(visibility),
    save: vi.fn().mockResolvedValue(undefined),
  };
  const work: InboxUnitOfWork = {
    run: async (_organizationId, execute) => execute(store as unknown as InboxStore),
  };
  return { store, useCase: new MarkNotificationRead(work) };
}

describe('MarkNotificationRead', () => {
  it('checks access before returning the current version', async () => {
    const { store, useCase } = fixture('hidden');
    await expect(useCase.execute({ ...input, expectedVersion: 999 })).rejects.toMatchObject({
      code: 'notification.not-found',
    });
    expect(store.save).not.toHaveBeenCalled();
  });

  it('does not mutate when current visibility cannot be verified', async () => {
    const { store, useCase } = fixture('unavailable');
    await expect(useCase.execute(input)).rejects.toThrow(
      'Current inbox visibility is unavailable.',
    );
    expect(store.save).not.toHaveBeenCalled();
  });

  it('persists the first read in the same transaction', async () => {
    const { store, useCase } = fixture('visible');
    const result = await useCase.execute(input);
    expect(result.readAt).toBe(2000);
    expect(result.version).toBe(2);
    expect(store.save).toHaveBeenCalledOnce();
  });
});
