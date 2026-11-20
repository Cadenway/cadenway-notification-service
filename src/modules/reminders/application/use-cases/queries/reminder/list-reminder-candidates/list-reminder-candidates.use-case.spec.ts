import { describe, expect, it, vi } from 'vitest';

import { Reminder } from '../../../../../domain/aggregates/reminder/reminder.aggregate.js';
import type { ReminderCandidatesReader } from '../../../../ports/outbound/persistence/reminder/reminder-candidates-reader.port.js';
import { ListSelectedReminders } from '../list-selected-reminders/list-selected-reminders.use-case.js';
import { ListReminderCandidates } from './list-reminder-candidates.use-case.js';

const reminder = Reminder.schedule(
  {
    id: 'reminder',
    organizationId: 'atelier',
    userId: 'camille',
    taskId: 'task',
    remindAt: 2000,
    note: 'Private note',
  },
  1000,
);

describe('private reminder scans', () => {
  it('returns only task references and positions without private note', async () => {
    const page = vi.fn().mockResolvedValue({ generation: '2', items: [reminder], hasMore: true });
    const reader: ReminderCandidatesReader = { page, selected: vi.fn() };
    const input = {
      organizationId: 'atelier',
      userId: 'camille',
      expectedGeneration: '2',
      after: null,
      limit: 1,
    };
    await expect(new ListReminderCandidates(reader).execute(input)).resolves.toEqual({
      generation: '2',
      items: [{ id: 'reminder', taskId: 'task', remindAt: 2000 }],
      hasMore: true,
    });
    expect(page).toHaveBeenCalledWith(input);
  });

  it('verifies the snapshot even when the selected page is empty', async () => {
    const selected = vi.fn().mockResolvedValue([]);
    const reader: ReminderCandidatesReader = { page: vi.fn(), selected };
    const input = {
      organizationId: 'atelier',
      userId: 'camille',
      expectedGeneration: '2',
      pairs: [],
    };
    await expect(new ListSelectedReminders(reader).execute(input)).resolves.toEqual([]);
    expect(selected).toHaveBeenCalledWith(input);
  });
});
