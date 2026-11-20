import {
  INBOX_AUTHORIZATION_MAX_ATTEMPTS,
  INBOX_AUTHORIZATION_WINDOW_MS,
} from '../../../../models/inbox/inbox-authorization-retry.model.js';
import type { InboxDeliveryUnitOfWork } from '../../../../ports/outbound/transactions/inbox/inbox-delivery-unit-of-work.port.js';
import type { RetryInboxDeliveryAuthorizationInput } from './retry-inbox-delivery-authorization.input.js';
import type { RetryInboxDeliveryAuthorizationOutput } from './retry-inbox-delivery-authorization.output.js';

/** Replaces an elapsed authorization without changing the recipient and source identity. */
export class RetryInboxDeliveryAuthorization {
  // #region Constructor
  /** Binds the recipient delivery transaction and the UTC clock. */
  public constructor(
    private readonly work: InboxDeliveryUnitOfWork,
    private readonly clock: () => number,
  ) {}
  // #endregion

  // #region Methods
  /** Rechecks the locked predecessor and issues at most one replacement for it. */
  public execute(
    input: RetryInboxDeliveryAuthorizationInput,
  ): Promise<RetryInboxDeliveryAuthorizationOutput> {
    const { organizationId, attemptId, retryCount } = input;
    if (
      !Number.isSafeInteger(retryCount) ||
      retryCount < 1 ||
      retryCount > INBOX_AUTHORIZATION_MAX_ATTEMPTS
    ) {
      throw new RangeError('Invalid inbox authorization attempt count.');
    }
    return this.work.run(organizationId, async (store) => {
      const attempt = await store.lockAttempt(organizationId, attemptId);
      if (attempt === null || attempt.outcome === 'permitted' || attempt.outcome === 'denied') {
        return false;
      }
      const now = this.clock();
      if (!Number.isSafeInteger(now) || now < attempt.expiresAt) {
        throw new Error('Inbox authorization deadline has not elapsed.');
      }
      if (retryCount === INBOX_AUTHORIZATION_MAX_ATTEMPTS) {
        if (attempt.outcome === 'pending') {
          await store.finishAttempt(organizationId, attemptId, 'expired');
        }
        return false;
      }
      const expiresAt = now + INBOX_AUTHORIZATION_WINDOW_MS;
      await store.renewAttempt(organizationId, attemptId, expiresAt, retryCount + 1);
      if (this.clock() >= expiresAt) {
        throw new Error('Inbox replacement authorization elapsed while staging.');
      }
      return true;
    });
  }
  // #endregion
}
