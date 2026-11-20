import type { NotificationPreferencesPatch } from '../../../../../domain/value-objects/preferences/notification-preferences-patch.value-object.js';

/** Validated input to UpdateNotificationPreferences. */
export interface UpdateNotificationPreferencesInput {
  // #region Properties
  /** Fields supplied or returned by this operation. */
  readonly userId: string;
  readonly patch: NotificationPreferencesPatch;
  readonly expectedVersions?: readonly number[] | '*' | undefined;
  // #endregion
}
