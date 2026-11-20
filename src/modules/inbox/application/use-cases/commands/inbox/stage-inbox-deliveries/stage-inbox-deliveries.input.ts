import type { InboxDeliveryCandidate } from '../../../../models/inbox/inbox-delivery-candidate.model.js';

/** Redacted source fact plus source-defined audiences in descending priority. */
export interface StageInboxDeliveriesInput {
  // #region Properties
  /** Fields common to each delivery candidate for this Task fact. */
  readonly source: Omit<InboxDeliveryCandidate, 'kind' | 'recipientId'>;

  /** A person in multiple audiences gets the first kind only. */
  readonly audiences: readonly {
    readonly kind: InboxDeliveryCandidate['kind'];
    readonly recipientIds: readonly string[];
  }[];

  /** Exclusive authorization deadline in UTC epoch milliseconds. */
  readonly expiresAt: number;
  // #endregion
}
