import { InboxNotification } from '../../../../../domain/aggregates/inbox/inbox-notification.aggregate.js';
import type { BillingNoticeUnitOfWork } from '../../../../ports/outbound/transactions/inbox/billing-notice-unit-of-work.port.js';
import type { RecordBillingNoticeInput } from './record-billing-notice.input.js';

/** Persists one subjectless billing receipt for a currently authorized account. */
export class RecordBillingNotice {
  // #region Constructor
  /** Binds the Inbox write transaction, Billing preference and receipt clock. */
  public constructor(
    private readonly work: BillingNoticeUnitOfWork,
    private readonly inAppEnabled: (recipientId: string) => Promise<boolean>,
    private readonly now: () => number,
  ) {}
  // #endregion

  // #region Methods
  /** Checks the channel and inserts the idempotent receipt with no billing or resource details. */
  public execute({
    organizationId,
    recipientId,
    sourceEventId,
  }: RecordBillingNoticeInput): Promise<boolean> {
    return this.work.run(organizationId, async (store) => {
      if (!(await this.inAppEnabled(recipientId))) return false;
      const id = await store.newId(organizationId);
      const { notification, fact } = InboxNotification.create({
        id,
        organizationId,
        recipientId,
        kind: 'billing',
        actorUserId: null,
        subject: null,
        createdAt: this.now(),
      });
      return store.insert(organizationId, recipientId, sourceEventId, notification, fact);
    });
  }
  // #endregion
}
