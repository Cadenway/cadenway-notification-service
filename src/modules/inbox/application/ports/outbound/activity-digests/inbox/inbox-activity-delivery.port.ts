import type { StageInboxDeliveriesInput } from '../../../../use-cases/commands/inbox/stage-inbox-deliveries/stage-inbox-deliveries.input.js';

/** Hands the same trusted Task events to the independent activity email capability. */
export interface InboxActivityDelivery {
  // #region Methods
  /** Stages redacted candidates from the source audience, independently of in-app eligibility. */
  stage(input: Pick<StageInboxDeliveriesInput, 'source' | 'audiences'>): Promise<number>;
  // #endregion
}
