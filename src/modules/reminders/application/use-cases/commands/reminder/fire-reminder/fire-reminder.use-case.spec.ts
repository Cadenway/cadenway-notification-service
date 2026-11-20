import { describe, expect, it, vi } from 'vitest';

import { Reminder } from '../../../../../domain/aggregates/reminder/reminder.aggregate.js';
import type { ReminderStore } from '../../../../ports/outbound/transactions/reminder/reminder-store.port.js';
import type { RemindersUnitOfWork } from '../../../../ports/outbound/transactions/reminder/reminders-unit-of-work.port.js';
import { FireReminder } from './fire-reminder.use-case.js';

const input = {
  organizationId: 'atelier',
  userId: 'camille',
  id: 'reminder',
  scheduleVersion: 1,
  now: 2000,
};
const reminder = Reminder.schedule(
  {
    id: 'reminder',
    organizationId: 'atelier',
    userId: 'camille',
    taskId: 'task',
    remindAt: 2000,
    note: 'Préparer la réunion',
  },
  1000,
);

function fixture(visibility: 'visible' | 'hidden' | 'unavailable') {
  const store = {
    findById: vi.fn().mockResolvedValue(reminder),
    taskVisibility: vi.fn().mockResolvedValue(visibility),
    save: vi.fn().mockResolvedValue(undefined),
    recordDue: vi.fn().mockResolvedValue(undefined),
  };
  const work: RemindersUnitOfWork = {
    run: async (_organizationId, execute) => execute(store as unknown as ReminderStore),
  };
  return { store, useCase: new FireReminder(work) };
}

describe('FireReminder', () => {
  it('saves a current due reminder and records its fact in the same transaction', async () => {
    const { store, useCase } = fixture('visible');
    expect(await useCase.execute(input)).toBe(true);
    expect(store.save).toHaveBeenCalledOnce();
    expect(store.recordDue).toHaveBeenCalledWith({
      reminderId: 'reminder',
      organizationId: 'atelier',
      userId: 'camille',
      taskId: 'task',
      remindAt: 2000,
      firedAt: 2000,
      version: 2,
    });
  });

  it('ignores a stale job without recording a duplicate fact', async () => {
    const { store, useCase } = fixture('visible');
    expect(await useCase.execute({ ...input, scheduleVersion: 2 })).toBe(false);
    expect(store.save).not.toHaveBeenCalled();
    expect(store.recordDue).not.toHaveBeenCalled();
  });

  it('does not emit or mark fired when access was revoked', async () => {
    const { store, useCase } = fixture('hidden');
    expect(await useCase.execute(input)).toBe(false);
    expect(store.save).not.toHaveBeenCalled();
    expect(store.recordDue).not.toHaveBeenCalled();
  });

  it('lets an unavailable visibility authority retry without a state change', async () => {
    const { store, useCase } = fixture('unavailable');
    await expect(useCase.execute(input)).rejects.toThrow(
      'Current reminder visibility is unavailable.',
    );
    expect(store.save).not.toHaveBeenCalled();
    expect(store.recordDue).not.toHaveBeenCalled();
  });
});
