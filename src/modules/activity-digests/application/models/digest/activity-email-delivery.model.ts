import type { ActivityEmailCandidate } from './activity-email-candidate.model.js';

/** One leased bounded occurrence and its current Task authorization decisions. */
export interface ActivityEmailDelivery {
  // #region Properties
  /** Values scoped to this operation. */
  readonly occurrenceId: string;
  readonly generation: number;
  readonly leaseId: string;
  readonly recipientId: string;
  readonly profileVersion: number;
  readonly preferencesVersion: number;
  readonly items: readonly {
    readonly candidate: ActivityEmailCandidate;
    readonly decision: 'permit' | 'deny';
    readonly validUntil: number;
  }[];
  // #endregion
}
