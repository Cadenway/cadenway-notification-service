import type { StageInboxDeliveriesInput } from '../stage-inbox-deliveries/stage-inbox-deliveries.input.js';

/** Redacted source audience and the original Task envelope fields required for worker deduplication. */
export interface StageTaskNotificationFactInput extends StageInboxDeliveriesInput {
  // #region Properties
  /** The actor as declared by Task, including non-user actors. */
  readonly actor: { readonly type: string; readonly id: string };

  /** Canonical source event timestamp. */
  readonly occurredAt: string;

  /** Version of the source envelope at publication. */
  readonly version: number;
  // #endregion
}
