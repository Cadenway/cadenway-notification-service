import type { InvitationEmailSkipReason } from '../../../../../domain/value-objects/invitation-email/invitation-email-skip-reason.value-object.js';

/**
 * Type RequestInvitationEmailOutput
 *
 * @description
 * What became of the invitation: `queued`, its e-mail is recorded and its job enqueued, and
 * `superseded` older deliveries of the same invitation were skipped; `skipped`, it is recorded
 * without a job, for a reason; `duplicate`, the event was already handled and nothing was written.
 *
 * @type {{ readonly outcome: 'queued'; readonly deliveryId: string; readonly superseded: number } | { readonly outcome: 'skipped'; readonly deliveryId: string; readonly reason: InvitationEmailSkipReason } | { readonly outcome: 'duplicate' }}
 */
export type RequestInvitationEmailOutput =
  | { readonly outcome: 'queued'; readonly deliveryId: string; readonly superseded: number }
  | {
      readonly outcome: 'skipped';
      readonly deliveryId: string;
      readonly reason: InvitationEmailSkipReason;
    }
  | { readonly outcome: 'duplicate' };
