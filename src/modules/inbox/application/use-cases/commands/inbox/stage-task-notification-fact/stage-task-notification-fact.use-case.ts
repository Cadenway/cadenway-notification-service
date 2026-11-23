import type { InboxActivityDelivery } from '../../../../ports/outbound/activity-digests/inbox/inbox-activity-delivery.port.js';
import type { StageInboxDeliveries } from '../stage-inbox-deliveries/stage-inbox-deliveries.use-case.js';
import type { StageTaskNotificationFactInput } from './stage-task-notification-fact.input.js';

/** Atomically stages Inbox delivery and a durable email handoff for a trusted Task fact. */
export class StageTaskNotificationFact {
  // #region Constructor
  /** Binds Inbox staging and the email capability's consumer port. */
  public constructor(
    private readonly inbox: Pick<StageInboxDeliveries, 'execute'>,
    private readonly activity: InboxActivityDelivery,
  ) {}
  // #endregion

  // #region Methods
  /** Enqueues eligible source categories even when Inbox creates no delivery. */
  public async execute(input: StageTaskNotificationFactInput): Promise<void> {
    await this.inbox.execute({
      source: input.source,
      audiences: input.audiences,
      expiresAt: input.expiresAt,
    });
    const audiences = input.audiences.filter(
      ({ kind, recipientIds }) => kind !== 'approval' && recipientIds.length > 0,
    );
    if (audiences.length === 0) return;
    await this.activity.enqueue({
      source: input.source,
      audiences,
      actor: input.actor,
      occurredAt: input.occurredAt,
      version: input.version,
    });
  }
  // #endregion
}
