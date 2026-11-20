import { describe, expect, it, vi } from 'vitest';

import { Reminder } from '../../../../../domain/aggregates/reminder/reminder.aggregate.js';
import type { ReminderStore } from '../../../../ports/outbound/transactions/reminder/reminder-store.port.js';
import type { RemindersUnitOfWork } from '../../../../ports/outbound/transactions/reminder/reminders-unit-of-work.port.js';
import { UpdateReminderNote } from './update-reminder-note.use-case.js';

describe('UpdateReminderNote', () => {
  it('conceals a mismatched task before reporting a stale version', async () => {
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
    const save = vi.fn().mockResolvedValue(undefined);
    const store = {
      findById: vi.fn().mockResolvedValue(reminder),
      save,
    } as unknown as ReminderStore;
    const work: RemindersUnitOfWork = {
      run: (_organizationId, execute) => execute(store),
    };
    await expect(
      new UpdateReminderNote(work).execute({
        organizationId: 'atelier',
        userId: 'camille',
        id: 'reminder',
        authorizedTaskId: 'another-task',
        expectedVersions: [20],
        note: null,
      }),
    ).rejects.toMatchObject({ code: 'reminder.not-found' });
    expect(save).not.toHaveBeenCalled();
  });
});
