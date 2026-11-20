import type { Reminder } from '../../../../../domain/aggregates/reminder/reminder.aggregate.js';

/** Reads reminders after current task visibility has been established. */
export interface RemindersReader {
  // #region Methods
  /** Lists only currently readable pending reminders, in (remindAt, id) order. */
  list(input: {
    readonly organizationId: string;
    readonly userId: string;
    readonly cursor: string | null;
    readonly limit: number;
  }): Promise<{
    readonly items: readonly Reminder[];
    readonly nextCursor: string | null;
    readonly pendingCount: number;
  }>;
  // #endregion
}
