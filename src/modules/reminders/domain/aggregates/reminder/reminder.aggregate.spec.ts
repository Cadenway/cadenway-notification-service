import { describe, expect, it } from 'vitest';

import { ReminderError } from '../../errors/reminder/reminder.error.js';
import { Reminder } from './reminder.aggregate.js';

const now = Date.parse('2026-11-08T12:00:00Z');
const remindAt = Date.parse('2026-11-08T14:00:00Z');
const next = Date.parse('2026-11-09T09:00:00Z');
const input = {
  id: '019a7000-1a2b-7c3d-8e4f-5a6b7c8d9e11',
  organizationId: '019a7000-1a2b-7c3d-8e4f-5a6b7c8d9e02',
  userId: '019a7000-1a2b-7c3d-8e4f-5a6b7c8d9e03',
  taskId: '019a7000-1a2b-7c3d-8e4f-5a6b7c8d9e05',
  remindAt,
  note: 'Relancer Léa pour les maquettes',
};

describe('Reminder', () => {
  it('starts one pending schedule and refuses a new time at or before now', () => {
    const reminder = Reminder.schedule(input, now);

    expect(reminder.snapshot).toEqual({
      ...input,
      createdAt: now,
      firedAt: null,
      completedAt: null,
      version: 1,
      scheduleVersion: 1,
    });
    expect(reminder.isPending).toBe(true);
    for (const past of [now, now - 1]) {
      expect(() => Reminder.schedule({ ...input, remindAt: past }, now)).toThrow(
        expect.objectContaining({ code: 'reminder.date-not-in-future' }),
      );
    }
  });

  it('fires a due schedule once and keeps it pending until explicit completion', () => {
    const current = Reminder.schedule(input, now);
    expect(current.fireIfDue(1, remindAt - 1)).toEqual({ reminder: current, fact: null });

    const { reminder, fact } = current.fireIfDue(1, remindAt);
    expect(reminder.isPending).toBe(true);
    expect(reminder.snapshot).toMatchObject({ firedAt: remindAt, version: 2, scheduleVersion: 1 });
    expect(fact).toEqual({
      reminderId: input.id,
      organizationId: input.organizationId,
      userId: input.userId,
      taskId: input.taskId,
      remindAt,
      firedAt: remindAt,
      version: 2,
    });
    expect(reminder.fireIfDue(1, remindAt + 1)).toEqual({ reminder, fact: null });
  });

  it('preserves the current schedule and firing on note edits and exact repeats', () => {
    const initial = Reminder.schedule(input, now);
    const edited = initial.changeNote('Relancer Léa');
    const { reminder } = edited.fireIfDue(1, remindAt);

    expect(edited.snapshot).toMatchObject({ version: 2, scheduleVersion: 1 });
    expect(reminder.setSchedule(remindAt, 'Relancer Léa', remindAt + 1)).toBe(reminder);
    expect(reminder.snooze(remindAt, remindAt + 1)).toBe(reminder);
    const cleared = reminder.setSchedule(remindAt, null, remindAt + 1);
    expect(cleared.snapshot).toMatchObject({
      note: null,
      firedAt: remindAt,
      version: 4,
      scheduleVersion: 1,
    });
  });

  it('only a changed future time clears firing and replaces the schedule revision', () => {
    const prior = Reminder.schedule(input, now).fireIfDue(1, remindAt).reminder;
    const snoozed = prior.snooze(next, remindAt + 1);

    expect(snoozed.snapshot).toMatchObject({
      id: input.id,
      note: input.note,
      remindAt: next,
      firedAt: null,
      version: 3,
      scheduleVersion: 3,
    });
    expect(snoozed.fireIfDue(1, next)).toEqual({ reminder: snoozed, fact: null });
    expect(snoozed.fireIfDue(3, next).fact).toMatchObject({ remindAt: next });
    expect(() => prior.snooze(now, remindAt + 1)).toThrow(ReminderError);
  });

  it('completes once and refuses later edits while invalidating queued jobs', () => {
    const completed = Reminder.schedule(input, now).complete(now);

    expect(completed.isPending).toBe(false);
    expect(completed.snapshot).toMatchObject({ completedAt: now, version: 2 });
    expect(completed.complete(now + 1)).toBe(completed);
    expect(completed.fireIfDue(1, remindAt)).toEqual({ reminder: completed, fact: null });
    expect(() => completed.snooze(next, now)).toThrow(
      expect.objectContaining({ code: 'reminder.already-completed' }),
    );
    expect(() => completed.changeNote(input.note)).toThrow(ReminderError);
  });

  it('counts reminder notes in Unicode code points and refuses invalid snapshots', () => {
    const current = Reminder.schedule(input, now);
    const note = String.fromCodePoint(0x1f642).repeat(500);

    expect(current.changeNote(note).snapshot.note).toBe(note);
    expect(() => current.changeNote(note + 'a')).toThrow(ReminderError);
    expect(() => Reminder.restore({ ...current.snapshot, scheduleVersion: 2 })).toThrow(
      ReminderError,
    );
    expect(() => Reminder.restore({ ...current.snapshot, firedAt: remindAt - 1 })).toThrow(
      ReminderError,
    );
  });

  it('conceals a reminder when the caller has lost task access', () => {
    const current = Reminder.schedule(input, now);

    expect(() => {
      current.requireAccess(input.organizationId, input.userId, false);
    }).toThrow(expect.objectContaining({ code: 'reminder.not-found' }));
    expect(() => {
      current.requireAccess(input.organizationId, 'another user', true);
    }).toThrow(expect.objectContaining({ code: 'reminder.not-found' }));
    expect(() => {
      current.requireAccess(input.organizationId, input.userId, true);
    }).not.toThrow();
  });
});
