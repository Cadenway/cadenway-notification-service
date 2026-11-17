import type { SecurityEmailSkipReason } from '../../../../../domain/value-objects/security-email/security-email-skip-reason.value-object.js';

/**
 * Type RequestSecurityEmailOutput
 *
 * @description
 * What became of the event: `queued`, its e-mail is recorded and its job enqueued; `skipped`, it is
 * recorded without a job, for a reason; `duplicate`, the event was already handled and nothing was
 * written.
 *
 * @type {{ readonly outcome: 'queued'; readonly deliveryId: string } | { readonly outcome: 'skipped'; readonly deliveryId: string; readonly reason: SecurityEmailSkipReason } | { readonly outcome: 'duplicate' }}
 */
export type RequestSecurityEmailOutput =
  | { readonly outcome: 'queued'; readonly deliveryId: string }
  | {
      readonly outcome: 'skipped';
      readonly deliveryId: string;
      readonly reason: SecurityEmailSkipReason;
    }
  | { readonly outcome: 'duplicate' };
