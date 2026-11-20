import type { ActivityEmailReservation } from './activity-email-reservation.model.js';

/** One candidate and the precise occurrence generation that will deliver it. */
export interface ActivityEmailAssignment {
  // #region Properties
  /** Opaque candidate ID and the reserved occurrence. */
  readonly candidateId: string;
  readonly reservation: ActivityEmailReservation;
  // #endregion
}
