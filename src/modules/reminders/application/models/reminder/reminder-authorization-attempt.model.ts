/** A durable authorization request bound to one exact reminder generation. */
export interface ReminderAuthorizationAttempt {
  // #region Properties
  /** Fields fixed for the durable attempt. */
  readonly id: string;
  readonly organizationId: string;
  readonly reminderId: string;
  readonly userId: string;
  readonly taskId: string;
  readonly reminderVersion: number;
  readonly scheduleVersion: number;
  readonly expiresAt: number;
  readonly status: 'pending' | 'permitted' | 'denied' | 'expired';
  // #endregion
}
