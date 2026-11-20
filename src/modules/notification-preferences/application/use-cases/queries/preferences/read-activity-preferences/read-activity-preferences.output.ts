/** Current account settings used when choosing and checking activity email delivery. */
export interface ReadActivityPreferencesOutput {
  // #region Properties
  /** The account that owns these preferences. */
  readonly userId: string;

  /** Independently configured delivery channels for each configurable category. */
  readonly channels: Readonly<
    Record<
      'mention' | 'assignment' | 'comment' | 'statusChange' | 'dueDate' | 'access' | 'billing',
      Readonly<{ inApp: boolean; email: boolean; mobile: boolean }>
    >
  >;

  /** Current activity email cadence. */
  readonly digest: 'each' | 'daily' | 'weekly' | 'never';

  /** Current mobile quiet-hours setting. */
  readonly doNotDisturb: boolean;

  /** Used to invalidate scheduled occurrences after a preference change. */
  readonly version: number;
  // #endregion
}
