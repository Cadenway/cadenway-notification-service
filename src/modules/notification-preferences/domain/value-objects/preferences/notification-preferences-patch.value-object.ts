import type { NotificationPreferencesSnapshot } from './notification-preferences-snapshot.value-object.js';

/** Explicitly provided settings in an account's preferences patch. */
export interface NotificationPreferencesPatch {
  // #region Properties
  /** Changes to individual channel flags for the supplied categories. */
  readonly channels?: {
    readonly [Category in keyof NotificationPreferencesSnapshot['channels']]?: Partial<
      NotificationPreferencesSnapshot['channels'][Category]
    >;
  };
  readonly digest?: NotificationPreferencesSnapshot['digest'];
  readonly doNotDisturb?: boolean;
  // #endregion
}
