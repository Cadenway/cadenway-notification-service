import type { CodeEmailSkipReason } from '../../../../../domain/value-objects/code-email/code-email-skip-reason.value-object.js';

/**
 * Type RequestCodeEmailResult
 *
 * @description
 * What became of the code: `queued`, its e-mail is recorded and its job enqueued; `skipped`, it is
 * recorded without a job, for a reason; `duplicate`, the event was already handled and nothing was
 * written.
 *
 * @type {{ readonly outcome: 'queued'; readonly deliveryId: string } | { readonly outcome: 'skipped'; readonly deliveryId: string; readonly reason: CodeEmailSkipReason } | { readonly outcome: 'duplicate' }}
 */
export type RequestCodeEmailResult =
  | { readonly outcome: 'queued'; readonly deliveryId: string }
  | {
      readonly outcome: 'skipped';
      readonly deliveryId: string;
      readonly reason: CodeEmailSkipReason;
    }
  | { readonly outcome: 'duplicate' };
