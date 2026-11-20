import type { ActivityEmailReservation } from './activity-email-reservation.model.js';

/** Persistence state of the account's one digest slot at a local date. */
export interface ActivityEmailDigestSlot extends ActivityEmailReservation {
  // #region Properties
  /** Current scheduling and ownership state. */
  readonly state: 'scheduled' | 'superseded' | 'completed';
  readonly dueAtMs: number;
  readonly profileVersion: number;

  /** Whether the slot's existing due instant is still ahead and the slot has no lease. */
  readonly acceptsAssignments: boolean;
  // #endregion
}
