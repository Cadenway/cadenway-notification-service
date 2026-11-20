type ChannelSettings = Readonly<{ inApp: boolean; email: boolean; mobile: boolean }>;

/** Account-owned channel choices and cadence from Compte › Notifications. */
export interface NotificationPreferencesSnapshot {
  // #region Properties
  /** Account that owns the preferences. */
  readonly userId: string;
  readonly channels: Readonly<
    Record<
      'mention' | 'assignment' | 'comment' | 'statusChange' | 'dueDate' | 'access' | 'billing',
      ChannelSettings
    >
  >;
  readonly digest: 'each' | 'daily' | 'weekly' | 'never';
  readonly doNotDisturb: boolean;
  readonly version: number;
  // #endregion
}
