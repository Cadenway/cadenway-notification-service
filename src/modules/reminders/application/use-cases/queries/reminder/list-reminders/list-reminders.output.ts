import type { ReminderSnapshot } from '../../../../../domain/value-objects/reminder/reminder-snapshot.value-object.js';

/** A visibility-filtered page and the count across all accessible pending reminders. */
export interface ListRemindersOutput {
  // #region Properties
  /** Fields supplied or returned by this operation. */
  readonly items: readonly ReminderSnapshot[];
  readonly nextCursor: string | null;
  readonly pendingCount: number;
  // #endregion
}
