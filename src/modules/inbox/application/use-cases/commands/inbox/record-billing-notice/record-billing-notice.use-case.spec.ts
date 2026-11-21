import { describe, expect, it, vi } from 'vitest';

import type { InboxNoticeUnitOfWork } from '../../../../ports/outbound/transactions/inbox/inbox-notice-unit-of-work.port.js';
import { RecordBillingNotice } from './record-billing-notice.use-case.js';

const input = {
  organizationId: 'organization',
  recipientId: 'recipient',
  sourceEventId: 'billing-event',
};
const now = Date.parse('2026-11-19T10:00:00Z');

/** Models the receipt store and its insert-once result. */
function setup() {
  const store = {
    newId: vi.fn().mockResolvedValue('notice'),
    insert: vi.fn().mockResolvedValueOnce(true).mockResolvedValue(false),
  };
  const work: InboxNoticeUnitOfWork = { run: (_organization, run) => run(store) };
  const preference = vi.fn().mockResolvedValue(true);
  const command = new RecordBillingNotice(work, preference, () => now);
  return { store, preference, command };
}

describe('RecordBillingNotice', () => {
  it('checks the current channel inside the scoped write before allocating a receipt', async () => {
    const { command, store, preference } = setup();
    preference.mockResolvedValue(false);
    await expect(command.execute(input)).resolves.toBe(false);
    expect(preference).toHaveBeenCalledExactlyOnceWith(input.recipientId);
    expect(store.newId).not.toHaveBeenCalled();
    expect(store.insert).not.toHaveBeenCalled();
  });

  it('records a neutral unread receipt and propagates the no-op result on replay', async () => {
    const { command, store } = setup();
    await expect(command.execute(input)).resolves.toBe(true);
    await expect(command.execute(input)).resolves.toBe(false);
    expect(store.insert).toHaveBeenCalledTimes(2);
    expect(store.insert).toHaveBeenCalledWith(
      input.organizationId,
      input.recipientId,
      input.sourceEventId,
      {
        snapshot: {
          id: 'notice',
          organizationId: input.organizationId,
          recipientId: input.recipientId,
          kind: 'billing',
          actorUserId: null,
          subject: null,
          createdAt: now,
          readAt: null,
          archivedAt: null,
          version: 1,
        },
      },
      {
        notificationId: 'notice',
        organizationId: input.organizationId,
        recipientId: input.recipientId,
        createdAt: now,
      },
    );
  });
});
