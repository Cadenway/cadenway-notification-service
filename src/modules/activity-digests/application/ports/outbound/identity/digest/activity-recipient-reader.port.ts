import type { ActivityEmailRecipient } from '../../../../models/digest/activity-email-recipient.model.js';

/** Identity reader returning null for an inactive, deleted, missing or unverified account. */
export interface ActivityRecipientReader {
  // #region Methods
  /** Reads the current recipient or returns null when unavailable for email. */
  findCurrent(userId: string): Promise<ActivityEmailRecipient | null>;
  // #endregion
}
