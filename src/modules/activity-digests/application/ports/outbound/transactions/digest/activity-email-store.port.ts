import type { ActivityEmailOccurrence } from '../../../../../domain/value-objects/digest/activity-email-occurrence.value-object.js';
import type { ActivityEmailCandidate } from '../../../../models/digest/activity-email-candidate.model.js';
import type { ActivityEmailPreferences } from '../../../../models/digest/activity-email-preferences.model.js';

/** Atomic state and enqueue operations in the service-owned database. */
export interface ActivityEmailStore {
  // #region Methods
  /** Insert candidates once per tenant, source fact and recipient, without consulting Inbox. */
  stage(organizationId: string, candidates: readonly ActivityEmailCandidate[]): Promise<number>;

  /** Lock account preferences and the scheduling state in the current transaction. */
  lockPreferences(userId: string): Promise<ActivityEmailPreferences>;

  /** Bind a bounded eligible page and enqueue each new occurrence atomically. Daily and weekly
   * digest identity is account, cadence and local date across organizations. Each stable batch has
   * its own occurrence ID, and assignments cannot repeat across batches. Immediate occurrences are
   * unique per candidate. Jobs carry only opaque IDs and generation.
   */
  schedule(
    userId: string,
    preferences: ActivityEmailPreferences,
    occurrence: ActivityEmailOccurrence,
    limit: number,
  ): Promise<number>;
  // #endregion
}
