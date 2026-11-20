import type { ActivityEmailOccurrence } from '../../../domain/value-objects/digest/activity-email-occurrence.value-object.js';

/** Scheduling inputs for one due occurrence locked by the account worker. */
export interface ActivityEmailDelivery {
  // #region Properties
  /** Values scoped to this operation. */
  readonly occurrenceId: string;
  readonly generation: number;
  readonly recipientId: string;
  readonly cadence: ActivityEmailOccurrence['cadence'];
  readonly profileVersion: number;
  // #endregion
}
