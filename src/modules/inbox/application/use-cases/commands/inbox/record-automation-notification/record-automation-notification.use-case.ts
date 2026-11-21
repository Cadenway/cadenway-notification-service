import { InboxNotification } from '../../../../../domain/aggregates/inbox/inbox-notification.aggregate.js';
import type { InboxNoticeUnitOfWork } from '../../../../ports/outbound/transactions/inbox/inbox-notice-unit-of-work.port.js';
import type { RecordAutomationNotificationInput } from './record-automation-notification.input.js';
import type { RecordAutomationNotificationOutput } from './record-automation-notification.output.js';

/** Records an authorized automation notice, its generation and its redacted creation fact. */
export class RecordAutomationNotification {
  // #region Constructor
  /** Binds the existing inbox transaction, channel preference, occurrence identity and clock. */
  public constructor(
    private readonly work: InboxNoticeUnitOfWork,
    private readonly inAppEnabled: (recipientId: string) => Promise<boolean>,
    private readonly sourceId: (organizationId: string, ruleId: string, key: string) => string,
    private readonly now: () => number,
  ) {}
  // #endregion

  // #region Methods
  /** Joins the transaction storing the authorized command's receipt. */
  public execute({
    organizationId,
    taskKey,
    recipientUserId,
    ruleId,
    commandKey,
  }: RecordAutomationNotificationInput): Promise<RecordAutomationNotificationOutput> {
    return this.work.run(organizationId, async (store) => {
      if (!(await this.inAppEnabled(recipientUserId))) return { disposition: 'no_op' };

      const id = await store.newId(organizationId);
      const { notification, fact } = InboxNotification.create({
        id,
        organizationId,
        recipientId: recipientUserId,
        kind: 'automation',
        actorUserId: null,
        subject: { kind: 'task', id: taskKey },
        createdAt: this.now(),
      });
      await store.insert(
        organizationId,
        recipientUserId,
        this.sourceId(organizationId, ruleId, commandKey),
        notification,
        fact,
        { subject: { kind: 'task-key', taskKey } },
      );
      return { disposition: 'applied' };
    });
  }
  // #endregion
}
