import type { FactoryProvider } from '@nestjs/common';
import { CONFIG } from '@cadenway/nest-common';
import type { EmailConfig } from '../../../../../../config/app-config.js';
import { EMAIL_SENDER } from '../../../../composition/tokens/code-email/email-sender.token.js';
import type { EmailSender } from '../../../../application/ports/outbound/smtp/code-email/email-sender.port.js';
import { NodemailerEmailSender } from '../../../../infrastructure/adapters/smtp/nodemailer-email-sender.adapter.js';

/**
 * Constant emailSenderProvider
 *
 * @description
 * Creates the SMTP transport from validated application configuration.
 *
 * @type {FactoryProvider<EmailSender>}
 */
export const emailSenderProvider: FactoryProvider<EmailSender> = {
  provide: EMAIL_SENDER,
  inject: [CONFIG],
  useFactory: (config: EmailConfig): EmailSender =>
    new NodemailerEmailSender({
      host: config.SMTP_HOST,
      port: config.SMTP_PORT,
      user: config.SMTP_USER,
      password: config.SMTP_PASSWORD,
      from: config.MAIL_FROM,
      webAppUrl: config.WEB_APP_URL,
    }),
};
