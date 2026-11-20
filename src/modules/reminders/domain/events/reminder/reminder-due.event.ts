/** One delivery fact for the active schedule, carrying IDs and instants only. */
export interface ReminderDue {
  // #region Properties
  /** Identifies the reminder that became due. */
  readonly reminderId: string;
  readonly organizationId: string;
  readonly userId: string;
  readonly taskId: string;
  readonly remindAt: number;
  readonly firedAt: number;

  /** Version of the reminder after the active schedule fired. */
  readonly version: number;
  // #endregion
}
