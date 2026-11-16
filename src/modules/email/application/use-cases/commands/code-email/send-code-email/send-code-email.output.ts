import type { CodeEmailSkipReason } from '../../../../../domain/value-objects/code-email/code-email-skip-reason.value-object.js';
import type { CodeEmailTemplate } from '../../../../../domain/value-objects/code-email/code-email-template.value-object.js';
import type { CodeEmailDeliveryStatus } from '../../../../models/code-email/code-email-delivery-status.model.js';

/**
 * Type SendCodeEmailOutput
 *
 * @description
 * What the attempt did: `sent`, the SMTP server accepted the e-mail; `skipped`, it was not sent
 * for a reason; `failed`, its content was gone and it cannot be sent; `already-handled`, an
 * earlier attempt or the sweep had settled it; `missing`, no such delivery exists.
 *
 * @type {{ readonly outcome: 'sent'; readonly template: CodeEmailTemplate } | { readonly outcome: 'skipped'; readonly reason: CodeEmailSkipReason } | { readonly outcome: 'failed' } | { readonly outcome: 'already-handled'; readonly status: CodeEmailDeliveryStatus } | { readonly outcome: 'missing' }}
 */
export type SendCodeEmailOutput =
  | { readonly outcome: 'sent'; readonly template: CodeEmailTemplate }
  | { readonly outcome: 'skipped'; readonly reason: CodeEmailSkipReason }
  | { readonly outcome: 'failed' }
  | { readonly outcome: 'already-handled'; readonly status: CodeEmailDeliveryStatus }
  | { readonly outcome: 'missing' };
