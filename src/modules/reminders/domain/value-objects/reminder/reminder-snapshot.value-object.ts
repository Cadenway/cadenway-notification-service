/** Persisted personal reminder, using UTC epoch milliseconds. */
export interface ReminderSnapshot {
  // #region Properties
  /** Stable identifier of one lifecycle of the reminder. */
  readonly id: string;
  readonly organizationId: string;
  readonly userId: string;
  readonly taskId: string;
  readonly createdAt: number;
  readonly remindAt: number;
  readonly note: string | null;
  readonly firedAt: number | null;
  readonly completedAt: number | null;
  readonly version: number;

  /** Version of the last schedule change. Note edits and firing do not invalidate its job. */
  readonly scheduleVersion: number;
  // #endregion
}
