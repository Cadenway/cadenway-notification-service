import type { SendActivityNotice } from '../../../../email/public/activity-notice/send-activity-notice.js';
import type { ActivityEmailSender } from '../../../application/ports/outbound/email/digest/activity-email-sender.port.js';

/** Adapts an authorized occurrence to Email's privacy-minimized public operation. */
export function activityEmailSender(notice: SendActivityNotice): ActivityEmailSender {
  return {
    send: ({ occurrenceId, recipient, count, validUntil }) =>
      notice.execute({
        occurrenceId,
        address: recipient.email,
        language: recipient.language,
        count,
        validUntil,
      }),
  };
}
