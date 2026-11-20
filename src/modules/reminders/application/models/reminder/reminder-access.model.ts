import { ReminderError } from '../../../domain/errors/reminder/reminder.error.js';
import type { Reminder } from '../../../domain/aggregates/reminder/reminder.aggregate.js';

/** A failure to confirm current visibility, distinct from a concealed missing reminder. */
export class ReminderVisibilityUnavailable extends Error {
  // #region Constructor
  /** Keeps the unavailable response free of task and account details. */
  public constructor() {
    super('Current reminder visibility is unavailable.');
  }
  // #endregion
}

/** Checks ownership and the authority's current decision before any projection or version error. */
export function requireReminderAccess(
  reminder: Reminder | null,
  organizationId: string,
  userId: string,
  visibility: 'visible' | 'hidden' | 'unavailable',
): Reminder {
  if (visibility === 'unavailable') throw new ReminderVisibilityUnavailable();
  if (reminder === null) throw new ReminderError('reminder.not-found');
  reminder.requireAccess(organizationId, userId, visibility === 'visible');
  return reminder;
}

/** Carries the current representation version for the HTTP precondition response. */
export class ReminderVersionMismatch extends Error {
  // #region Constructor
  /** Stores the authorized current version or null for an absent representation. */
  public constructor(public readonly currentVersion: number | null) {
    super('Reminder version does not match.');
  }
  // #endregion
}

/** Checks an optional precondition after access has been verified. */
export function requireReminderVersion(
  expected: readonly number[] | '*' | undefined,
  actual: number | null,
): void {
  if (expected === undefined) return;
  if (actual === null || (expected !== '*' && !expected.includes(actual)))
    throw new ReminderVersionMismatch(actual);
}
