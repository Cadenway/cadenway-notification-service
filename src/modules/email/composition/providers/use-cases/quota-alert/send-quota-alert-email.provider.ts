import type { FactoryProvider } from '@nestjs/common';

import type { EmailSender } from '../../../../application/ports/outbound/smtp/code-email/email-sender.port.js';
import type { QuotaAlertRenderer } from '../../../../application/ports/outbound/templates/quota-alert/quota-alert-renderer.port.js';
import { SendQuotaAlertEmail } from '../../../../application/use-cases/commands/quota-alert/send-quota-alert-email/send-quota-alert-email.use-case.js';
import { EMAIL_RENDERER } from '../../../tokens/code-email/email-renderer.token.js';
import { EMAIL_SENDER } from '../../../tokens/code-email/email-sender.token.js';

/** Exposes quota submission through the existing Email runtime. */
export const sendQuotaAlertEmailProvider: FactoryProvider<SendQuotaAlertEmail> = {
  provide: SendQuotaAlertEmail,
  inject: [EMAIL_RENDERER, EMAIL_SENDER],
  useFactory: (renderer: QuotaAlertRenderer, sender: EmailSender) =>
    new SendQuotaAlertEmail(renderer, sender),
};
