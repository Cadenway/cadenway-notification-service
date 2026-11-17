import type { InvitationEmailSkipReason } from '../../../../../domain/value-objects/invitation-email/invitation-email-skip-reason.value-object.js';
import type { InvitationEmailDeliveryStatus } from '../../../../models/invitation-email/invitation-email-delivery-status.model.js';

/**
 * Type SendInvitationEmailOutput
 *
 * @description
 * What the attempt did: `sent`, the SMTP server accepted the e-mail; `skipped`, the invitation
 * expired before the e-mail could leave; `failed`, its content was gone and it cannot be sent;
 * `already-handled`, an earlier attempt, a later version or the sweep had settled it; `missing`,
 * no such delivery exists in the organization of the job.
 *
 * @type {{ readonly outcome: 'sent' } | { readonly outcome: 'skipped'; readonly reason: InvitationEmailSkipReason } | { readonly outcome: 'failed' } | { readonly outcome: 'already-handled'; readonly status: InvitationEmailDeliveryStatus } | { readonly outcome: 'missing' }}
 */
export type SendInvitationEmailOutput =
  | { readonly outcome: 'sent' }
  | { readonly outcome: 'skipped'; readonly reason: InvitationEmailSkipReason }
  | { readonly outcome: 'failed' }
  | { readonly outcome: 'already-handled'; readonly status: InvitationEmailDeliveryStatus }
  | { readonly outcome: 'missing' };
