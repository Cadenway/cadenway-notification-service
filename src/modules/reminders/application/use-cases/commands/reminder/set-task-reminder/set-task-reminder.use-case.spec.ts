import { describe, expect, it, vi } from 'vitest';

import { Reminder } from '../../../../../domain/aggregates/reminder/reminder.aggregate.js';
import type { ReminderStore } from '../../../../ports/outbound/transactions/reminder/reminder-store.port.js';
import type { RemindersUnitOfWork } from '../../../../ports/outbound/transactions/reminder/reminders-unit-of-work.port.js';
import { SetTaskReminder } from './set-task-reminder.use-case.js';

const input = {
  organizationId: 'atelier',
  userId: 'camille',
  taskId: 'task',
  remindAt: 2000,
  note: null,
  now: 1000,
};

function fixture(existing: Reminder | null) {
  const store = {
    lockTaskSlot: vi.fn().mockResolvedValue(undefined),
    allocateId: vi.fn().mockResolvedValue('reminder'),
    findPending: vi.fn().mockResolvedValue(existing),
    save: vi.fn().mockResolvedValue(undefined),
    schedule: vi.fn().mockResolvedValue(undefined),
  };
  const work: RemindersUnitOfWork = {
    run: async (_organizationId, execute) => execute(store as unknown as ReminderStore),
  };
  return { store, useCase: new SetTaskReminder(work) };
}

describe('SetTaskReminder', () => {
  it('locks the task slot and atomically saves and schedules a new reminder', async () => {
    const { store, useCase } = fixture(null);
    const result = await useCase.execute(input);
    expect(result.created).toBe(true);
    expect(result.reminder.version).toBe(1);
    expect(store.lockTaskSlot).toHaveBeenCalledWith('atelier', 'camille', 'task');
    expect(store.save).toHaveBeenCalledOnce();
    expect(store.allocateId).toHaveBeenCalledOnce();
    expect(store.schedule).toHaveBeenCalledOnce();
    expect(store.lockTaskSlot.mock.invocationCallOrder[0]).toBeLessThan(
      store.findPending.mock.invocationCallOrder[0] ?? 0,
    );
  });

  it('keeps a replayed time and job even after the scheduled instant', async () => {
    const reminder = Reminder.schedule(
      {
        id: 'reminder',
        organizationId: 'atelier',
        userId: 'camille',
        taskId: 'task',
        remindAt: 2000,
        note: null,
      },
      1000,
    );
    const { store, useCase } = fixture(reminder);
    const result = await useCase.execute({ ...input, now: 3000 });
    expect(result.created).toBe(false);
    expect(result.reminder.version).toBe(1);
    expect(store.save).not.toHaveBeenCalled();
    expect(store.allocateId).not.toHaveBeenCalled();
    expect(store.schedule).not.toHaveBeenCalled();
  });

  it('does not match an If-Match precondition against an absent reminder', async () => {
    const { store, useCase } = fixture(null);
    await expect(useCase.execute({ ...input, expectedVersions: [1] })).rejects.toMatchObject({
      currentVersion: null,
    });
    expect(store.save).not.toHaveBeenCalled();
    expect(store.allocateId).not.toHaveBeenCalled();
  });

  it('requires an existing slot for the wildcard precondition', async () => {
    const { store, useCase } = fixture(null);
    await expect(useCase.execute({ ...input, expectedVersions: '*' })).rejects.toMatchObject({
      currentVersion: null,
    });
    expect(store.allocateId).not.toHaveBeenCalled();
  });

  it('accepts a version in a list and preserves the identifier', async () => {
    const reminder = Reminder.schedule(
      {
        id: 'reminder',
        organizationId: 'atelier',
        userId: 'camille',
        taskId: 'task',
        remindAt: 2000,
        note: null,
      },
      1000,
    );
    const { store, useCase } = fixture(reminder);
    const result = await useCase.execute({ ...input, expectedVersions: [20, 1] });
    expect(result.reminder.id).toBe('reminder');
    expect(store.allocateId).not.toHaveBeenCalled();
    expect(store.save).not.toHaveBeenCalled();
  });
});
