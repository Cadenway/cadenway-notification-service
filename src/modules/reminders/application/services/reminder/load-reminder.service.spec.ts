import { describe, expect, it, vi } from 'vitest';

import { Reminder } from '../../../domain/aggregates/reminder/reminder.aggregate.js';
import type { ReminderStore } from '../../ports/outbound/transactions/reminder/reminder-store.port.js';
import { loadReminder } from './load-reminder.service.js';

describe('loadReminder', () => {
  const reminder = Reminder.schedule(
    {
      id: 'reminder',
      organizationId: 'atelier',
      userId: 'camille',
      taskId: '019a7002-3c4d-7e5f-8a6b-7c8d9e0f1a23',
      remindAt: 2000,
      note: 'Private note',
    },
    1000,
  );
  const findById = vi.fn().mockResolvedValue(reminder);
  const store = { findById } as unknown as ReminderStore;

  it('rejects a mismatched checked task under the requested row lock', async () => {
    await expect(
      loadReminder(store, 'atelier', 'camille', 'reminder', 'another-task', true),
    ).rejects.toMatchObject({ code: 'reminder.not-found' });
    expect(findById).toHaveBeenCalledWith('atelier', 'camille', 'reminder', true);
  });

  it('accepts equivalent UUID casing after a successful access decision', async () => {
    await expect(
      loadReminder(
        store,
        'atelier',
        'camille',
        'reminder',
        reminder.snapshot.taskId.toUpperCase(),
        false,
      ),
    ).resolves.toBe(reminder);
  });
});
