import type { SecurityEmailSkipReason } from '../../../../../domain/value-objects/security-email/security-email-skip-reason.value-object.js';
import type { SecurityEmailTemplate } from '../../../../../domain/value-objects/security-email/security-email-template.value-object.js';
import type { SecurityEmailDeliveryStatus } from '../../../../models/security-email/security-email-delivery-status.model.js';

/**
 * Type SendSecurityEmailOutput
 *
 * @description
 * What the attempt did: `sent`, the SMTP server accepted the e-mail; `skipped`, its window closed;
 * `failed`, its content was gone and it cannot be sent; `already-handled`, an earlier attempt or
 * the sweep had settled it; `missing`, no such delivery exists.
 *
 * @type {{ readonly outcome: 'sent'; readonly template: SecurityEmailTemplate } | { readonly outcome: 'skipped'; readonly reason: SecurityEmailSkipReason } | { readonly outcome: 'failed' } | { readonly outcome: 'already-handled'; readonly status: SecurityEmailDeliveryStatus } | { readonly outcome: 'missing' }}
 */
export type SendSecurityEmailOutput =
  | { readonly outcome: 'sent'; readonly template: SecurityEmailTemplate }
  | { readonly outcome: 'skipped'; readonly reason: SecurityEmailSkipReason }
  | { readonly outcome: 'failed' }
  | { readonly outcome: 'already-handled'; readonly status: SecurityEmailDeliveryStatus }
  | { readonly outcome: 'missing' };
