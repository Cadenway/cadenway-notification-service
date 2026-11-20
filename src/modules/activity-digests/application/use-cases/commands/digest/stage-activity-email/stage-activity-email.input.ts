import type { ActivityEmailCandidate } from '../../../../models/digest/activity-email-candidate.model.js';

/** Source event identity and its source-defined audience in priority order. */
export interface StageActivityEmailInput {
  // #region Properties
  /** Values scoped to this operation. */
  readonly source: Omit<ActivityEmailCandidate, 'recipientId' | 'kind'>;
  readonly audiences: readonly {
    readonly kind: ActivityEmailCandidate['kind'];
    readonly recipientIds: readonly string[];
  }[];
  // #endregion
}
