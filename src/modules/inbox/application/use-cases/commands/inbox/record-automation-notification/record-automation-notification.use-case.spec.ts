import { describe, expect, it, vi } from 'vitest';

import type { InboxNoticeUnitOfWork } from '../../../../ports/outbound/transactions/inbox/inbox-notice-unit-of-work.port.js';
import type { RecordAutomationNotificationInput } from './record-automation-notification.input.js';
import { RecordAutomationNotification } from './record-automation-notification.use-case.js';

const input: RecordAutomationNotificationInput = {
  organizationId: 'organization',
  taskKey: 'CAD-482',
  ruleAuthorUserId: 'author',
  recipientUserId: 'recipient',
  ruleId: 'rule',
  commandKey: 'command',
};
const now = Date.parse('2026-11-19T10:00:00Z');

/** Supplies the tenant record store and current recipient preference. */
function setup() {
  const store = {
    newId: vi.fn().mockResolvedValue('notice'),
    insert: vi.fn().mockResolvedValue(true),
  };
  const calls: string[] = [];
  const work: InboxNoticeUnitOfWork = {
    run: (organizationId, execute) => {
      calls.push(organizationId);
      return execute(store);
    },
  };
  const enabled = vi.fn().mockResolvedValue(true);
  const deriveSourceId = vi.fn(() => 'occurrence');
  const command = new RecordAutomationNotification(work, enabled, deriveSourceId, () => now);
  return { calls, enabled, deriveSourceId, store, command };
}

describe('RecordAutomationNotification', () => {
  it('evaluates the current recipient channel inside the inbox transaction', async () => {
    const { calls, command, enabled, deriveSourceId, store } = setup();
    enabled.mockResolvedValue(false);

    await expect(command.execute(input)).resolves.toEqual({ disposition: 'no_op' });
    expect(calls).toEqual([input.organizationId]);
    expect(enabled).toHaveBeenCalledExactlyOnceWith(input.recipientUserId);
    expect(deriveSourceId).not.toHaveBeenCalled();
    expect(store.newId).not.toHaveBeenCalled();
    expect(store.insert).not.toHaveBeenCalled();
  });

  it('records a task-linked, unattributed notice under the rule command source identity', async () => {
    const { command, deriveSourceId, store } = setup();

    await expect(command.execute(input)).resolves.toEqual({ disposition: 'applied' });
    expect(deriveSourceId).toHaveBeenCalledExactlyOnceWith(
      input.organizationId,
      input.ruleId,
      input.commandKey,
    );
    expect(store.newId).toHaveBeenCalledExactlyOnceWith(input.organizationId);
    expect(store.insert).toHaveBeenCalledExactlyOnceWith(
      input.organizationId,
      input.recipientUserId,
      'occurrence',
      {
        snapshot: {
          id: 'notice',
          organizationId: input.organizationId,
          recipientId: input.recipientUserId,
          kind: 'automation',
          actorUserId: null,
          subject: { kind: 'task', id: input.taskKey },
          createdAt: now,
          readAt: null,
          archivedAt: null,
          version: 1,
        },
      },
      {
        notificationId: 'notice',
        organizationId: input.organizationId,
        recipientId: input.recipientUserId,
        createdAt: now,
      },
      { subject: { kind: 'task-key', taskKey: input.taskKey } },
    );
  });

  it('propagates a failed insert so the idempotency receipt can roll back with it', async () => {
    const { command, store } = setup();
    const failure = new Error('Inbox transaction failed.');
    store.insert.mockRejectedValue(failure);

    await expect(command.execute(input)).rejects.toBe(failure);
  });
});
