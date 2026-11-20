import { describe, expect, it, vi } from 'vitest';

import type { InboxSelectionUnitOfWork } from '../../../../ports/outbound/transactions/inbox/inbox-selection-unit-of-work.port.js';
import { ArchiveCheckedNotification } from '../archive-checked-notification/archive-checked-notification.use-case.js';
import { ReadCheckedNotification } from '../read-checked-notification/read-checked-notification.use-case.js';
import { ReadSelectedNotifications } from './read-selected-notifications.use-case.js';

describe('authorized inbox writes', () => {
  it('passes exact checked linkage and all validators through one tenant transaction', async () => {
    const change = vi.fn().mockResolvedValue({ kind: 'not-found' });
    const readAll = vi.fn();
    const work: InboxSelectionUnitOfWork = {
      run: (_organizationId, execute) => execute({ change, readAll }),
    };
    const subject = { kind: 'task-key', taskKey: 'CAD-482' } as const;
    const input = {
      organizationId: 'org',
      recipientId: 'camille',
      notificationId: 'id',
      subject,
      expectedVersions: [1, 3],
    };
    await expect(new ReadCheckedNotification(work, () => 42).execute(input)).resolves.toEqual({
      kind: 'not-found',
    });
    expect(change).toHaveBeenCalledWith('org', 'camille', 'id', subject, 'read', [1, 3], 42);
    await new ArchiveCheckedNotification(work, () => 43).execute({
      ...input,
      expectedVersions: '*',
    });
    expect(change).toHaveBeenLastCalledWith('org', 'camille', 'id', subject, 'archive', '*', 43);
  });

  it('keeps the original cutoff and propagates scan conflicts without another write', async () => {
    const conflict = new Error('generation changed');
    const readAll = vi.fn().mockRejectedValue(conflict);
    const work: InboxSelectionUnitOfWork = {
      run: (_organizationId, execute) => execute({ change: vi.fn(), readAll }),
    };
    const selected = [{ kind: 'task-id', taskId: 'task' }] as const;
    await expect(
      new ReadSelectedNotifications(work, () => 42).execute({
        organizationId: 'org',
        recipientId: 'camille',
        snapshotGeneration: '19',
        creationCutoff: '18',
        authorizedSubjects: selected,
      }),
    ).rejects.toBe(conflict);
    expect(readAll).toHaveBeenCalledExactlyOnceWith('org', 'camille', '19', '18', selected, 42);
  });
});
