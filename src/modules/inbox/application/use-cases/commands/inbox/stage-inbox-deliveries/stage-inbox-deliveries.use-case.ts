import type { InboxDeliveryCandidate } from '../../../../models/inbox/inbox-delivery-candidate.model.js';
import type { InboxDeliveryUnitOfWork } from '../../../../ports/outbound/transactions/inbox/inbox-delivery-unit-of-work.port.js';
import type { StageInboxDeliveriesInput } from './stage-inbox-deliveries.input.js';
import type { StageInboxDeliveriesOutput } from './stage-inbox-deliveries.output.js';

/** Requests authorization once for each distinct recipient of the original source fact. */
export class StageInboxDeliveries {
  // #region Constructor
  /** Binds the recipient delivery transaction and UTC clock. */
  public constructor(
    private readonly work: InboxDeliveryUnitOfWork,
    private readonly clock: () => number,
  ) {}
  // #endregion

  // #region Methods
  /** Suppresses the actor and keeps one candidate in the highest-priority audience. */
  public execute(input: StageInboxDeliveriesInput): Promise<StageInboxDeliveriesOutput> {
    if (!Number.isSafeInteger(input.expiresAt) || input.expiresAt <= this.clock()) {
      throw new RangeError('Inbox authorization expiry must be in the future.');
    }
    const actorUserId = input.source.actorUserId?.toLowerCase();
    const recipients = new Map<string, InboxDeliveryCandidate>();
    for (const audience of input.audiences) {
      for (const id of audience.recipientIds) {
        const recipientId = id.toLowerCase();
        if (recipientId !== actorUserId && !recipients.has(recipientId)) {
          recipients.set(recipientId, { ...input.source, recipientId, kind: audience.kind });
        }
      }
    }
    if (recipients.size === 0) return Promise.resolve(0);
    return this.work.run(input.source.organizationId, async (store) => {
      if (input.expiresAt <= this.clock()) {
        throw new RangeError('Inbox authorization expiry elapsed before staging.');
      }
      const staged = await store.stage([...recipients.values()], input.expiresAt);
      if (staged > 0 && input.expiresAt <= this.clock()) {
        throw new RangeError('Inbox authorization expiry elapsed while staging.');
      }
      return staged;
    });
  }
  // #endregion
}
