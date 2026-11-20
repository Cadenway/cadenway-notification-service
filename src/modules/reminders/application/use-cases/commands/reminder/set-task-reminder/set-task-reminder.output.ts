import type { ReminderSnapshot } from '../../../../../domain/value-objects/reminder/reminder-snapshot.value-object.js';

/** The resulting representation and whether this call occupied a new task slot. */
export interface SetTaskReminderOutput {
  // #region Properties
  /** Fields supplied or returned by this operation. */
  readonly reminder: ReminderSnapshot;
  readonly created: boolean;
  // #endregion
}
