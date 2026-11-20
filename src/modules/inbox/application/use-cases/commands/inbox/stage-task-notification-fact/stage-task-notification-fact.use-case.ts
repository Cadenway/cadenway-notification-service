import type { InboxActivityDelivery } from '../../../../ports/outbound/activity-digests/inbox/inbox-activity-delivery.port.js';
import type { StageInboxDeliveriesInput } from '../stage-inbox-deliveries/stage-inbox-deliveries.input.js';
import type { StageInboxDeliveries } from '../stage-inbox-deliveries/stage-inbox-deliveries.use-case.js';

/** Stages one trusted Task fact for both independent channels within event deduplication. */
export class StageTaskNotificationFact {
  // #region Constructor
  /** Binds Inbox staging and the email capability's consumer port. */
  public constructor(
    private readonly inbox: Pick<StageInboxDeliveries, 'execute'>,
    private readonly activity: InboxActivityDelivery,
  ) {}
  // #endregion

  // #region Methods
  /** Stages the original audience even when Inbox creates no delivery. */
  public async execute(input: StageInboxDeliveriesInput): Promise<void> {
    await this.inbox.execute(input);
    const audiences = input.audiences.filter(({ kind }) => kind !== 'approval');
    await this.activity.stage({ source: input.source, audiences });
  }
  // #endregion
}
