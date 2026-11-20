import type { InboxAuthorizationRetry } from '../../../../models/inbox/inbox-authorization-retry.model.js';

/** Correlation from the trusted job that owns the elapsed authorization attempt. */
export type RetryInboxDeliveryAuthorizationInput = Pick<
  InboxAuthorizationRetry,
  'organizationId' | 'attemptId' | 'retryCount'
>;
