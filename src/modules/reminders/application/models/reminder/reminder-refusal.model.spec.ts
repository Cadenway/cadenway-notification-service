import { describe, expect, it } from 'vitest';

import { ReminderError } from '../../../domain/errors/reminder/reminder.error.js';
import { ReminderVersionMismatch, requireReminderVersion } from './reminder-access.model.js';
import { reminderRefusal } from './reminder-refusal.model.js';

describe('reminder version preconditions', () => {
  it('accepts an existing wildcard or a list containing the current version', () => {
    expect(() => {
      requireReminderVersion('*', 2);
    }).not.toThrow();
    expect(() => {
      requireReminderVersion([1, 2], 2);
    }).not.toThrow();
    expect(() => {
      requireReminderVersion(undefined, null);
    }).not.toThrow();
  });

  it('rejects absent and mismatched representations with their authorized version', () => {
    expect(() => {
      requireReminderVersion('*', null);
    }).toThrow(ReminderVersionMismatch);
    expect(() => {
      requireReminderVersion([1, 3], 2);
    }).toThrow(ReminderVersionMismatch);
    expect(reminderRefusal(new ReminderVersionMismatch(null))).toEqual({
      code: 'request.version-mismatch',
      status: 412,
      currentVersion: null,
    });
    expect(reminderRefusal(new ReminderVersionMismatch(2))).toEqual({
      code: 'request.version-mismatch',
      status: 412,
      currentVersion: 2,
    });
  });

  it('maps domain refusals without exposing private data', () => {
    expect(reminderRefusal(new ReminderError('reminder.not-found'))).toEqual({
      code: 'reminder.not-found',
      status: 404,
    });
    expect(reminderRefusal(new ReminderError('reminder.already-completed'))).toEqual({
      code: 'reminder.already-completed',
      status: 409,
    });
    expect(reminderRefusal(new ReminderError('reminder.date-not-in-future'))).toEqual({
      code: 'reminder.date-not-in-future',
      status: 422,
    });
    expect(reminderRefusal(new Error('unexpected'))).toBeNull();
  });
});
