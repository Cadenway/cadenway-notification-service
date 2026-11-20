/** One verified recipient and one configurable activity channel. */
export interface IsInAppNotificationEnabledInput {
  // #region Properties
  /** Account bound to the permitted candidate. */
  readonly userId: string;

  /** The activity category to evaluate. */
  readonly category:
    'mention' | 'assignment' | 'comment' | 'statusChange' | 'dueDate' | 'access' | 'billing';
  // #endregion
}
