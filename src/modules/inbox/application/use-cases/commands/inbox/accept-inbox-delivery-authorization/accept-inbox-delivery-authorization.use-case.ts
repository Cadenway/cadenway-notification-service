import { InboxNotification } from '../../../../../domain/aggregates/inbox/inbox-notification.aggregate.js';
import type { InboxDeliveryCandidate } from '../../../../models/inbox/inbox-delivery-candidate.model.js';
import type { InboxDeliveryUnitOfWork } from '../../../../ports/outbound/transactions/inbox/inbox-delivery-unit-of-work.port.js';
import type { AcceptInboxDeliveryAuthorizationInput } from './accept-inbox-delivery-authorization.input.js';
import type { AcceptInboxDeliveryAuthorizationOutput } from './accept-inbox-delivery-authorization.output.js';

/** Consumes a current Task decision at most once, atomically with any inbox effect. */
export class AcceptInboxDeliveryAuthorization {
  // #region Constructor
  /** Binds the tenant transaction and UTC clock read after acquiring the attempt lock. */
  public constructor(
    private readonly work: InboxDeliveryUnitOfWork,
    private readonly clock: () => number,
    private readonly inAppEnabled: (
      recipientId: string,
      kind: InboxDeliveryCandidate['kind'],
    ) => Promise<boolean>,
  ) {}
  // #endregion

  // #region Methods
  /** A late, wrong or previously consumed decision cannot write an inbox record. */
  public execute(
    input: AcceptInboxDeliveryAuthorizationInput,
  ): Promise<AcceptInboxDeliveryAuthorizationOutput> {
    return this.work.run(input.organizationId, async (store) => {
      const attempt = await store.lockAttempt(input.organizationId, input.attemptId);
      if (attempt?.outcome !== 'pending') return false;
      const now = this.clock();
      if (now >= attempt.expiresAt) {
        await store.finishAttempt(input.organizationId, attempt.id, 'expired');
        return false;
      }
      if (
        !Number.isSafeInteger(input.validUntil) ||
        !Number.isSafeInteger(input.decidedAt) ||
        now >= input.validUntil ||
        input.validUntil > attempt.expiresAt ||
        input.decidedAt >= input.validUntil
      ) {
        return false;
      }
      if (input.decision === 'deny') {
        await store.finishAttempt(input.organizationId, attempt.id, 'denied');
        return false;
      }
      const { organizationId, recipientId, taskKey, actorUserId, kind } = attempt.candidate;
      const inApp = await this.inAppEnabled(recipientId, kind);
      if (this.clock() >= input.validUntil) {
        throw new Error('Inbox authorization expired while reading the delivery preference.');
      }
      if (!inApp) {
        await store.finishAttempt(input.organizationId, attempt.id, 'permitted');
        return false;
      }
      const id = await store.newNotificationId(organizationId);
      const { notification, fact } = InboxNotification.create({
        id,
        organizationId,
        recipientId,
        subject: { kind: 'task', id: taskKey },
        actorUserId,
        kind,
        createdAt: now,
      });
      const created = await store.insertNotification(attempt.candidate, notification, fact);
      await store.finishAttempt(input.organizationId, attempt.id, 'permitted');
      if (this.clock() >= input.validUntil) {
        throw new Error('Inbox authorization expired while applying the attempt.');
      }
      return created;
    });
  }
  // #endregion
}
