import { CONFIG } from '@cadenway/nest-common';
import { Module } from '@nestjs/common';

import type { AppConfig } from '../../config/app-config.js';
import { ExpireCodeEmailsHandler } from './api/messaging/expire-code-emails.handler.js';
import { OneTimeCodeIssuedHandler } from './api/messaging/one-time-code-issued.handler.js';
import { SendCodeEmailHandler } from './api/messaging/send-code-email.handler.js';
import { ExpireCodeEmails } from './application/commands/expire-code-emails.js';
import { RequestCodeEmail } from './application/commands/request-code-email.js';
import { SendCodeEmail } from './application/commands/send-code-email.js';
import { CLOCK } from './application/ports/clock.port.js';
import type { Clock } from './application/ports/clock.port.js';
import { CODE_EMAIL_DELIVERIES } from './application/ports/code-email-deliveries.port.js';
import type { CodeEmailDeliveries } from './application/ports/code-email-deliveries.port.js';
import { CODE_EMAIL_QUEUE } from './application/ports/code-email-queue.port.js';
import type { CodeEmailQueue } from './application/ports/code-email-queue.port.js';
import { CODE_EMAIL_UNIT_OF_WORK } from './application/ports/code-email-unit-of-work.port.js';
import type { CodeEmailUnitOfWork } from './application/ports/code-email-unit-of-work.port.js';
import { EMAIL_RENDERER } from './application/ports/email-renderer.port.js';
import type { EmailRenderer } from './application/ports/email-renderer.port.js';
import { EMAIL_SENDER } from './application/ports/email-sender.port.js';
import type { EmailSender } from './application/ports/email-sender.port.js';
import { SystemClock } from './infrastructure/clock/system-clock.js';
import { JobsCodeEmailQueue } from './infrastructure/jobs/jobs-code-email-queue.js';
import { DrizzleCodeEmailDeliveryRepository } from './infrastructure/persistence/drizzle-code-email-delivery.repository.js';
import { SystemCodeEmailUnitOfWork } from './infrastructure/persistence/system-code-email-unit-of-work.js';
import { NodemailerEmailSender } from './infrastructure/smtp/nodemailer-email-sender.js';
import { HandlebarsEmailRenderer } from './infrastructure/templates/handlebars-email-renderer.js';

/**
 * Class EmailModule
 *
 * @description
 * The e-mails of the service. In this version, the two e-mails that carry a single-use code:
 * `one-time-code.issued.v1` of identity-service, read from `EVENTS_RESTRICTED`, becomes a delivery
 * of the send log and a durable job, which renders the template compiled at build time and sends
 * it through the SMTP server of the configuration; a scheduled sweep settles the deliveries whose
 * code expired before they could leave. See its `MODULE.md`.
 *
 * It relies on the global modules of `AppModule`: `CONFIG`, `DatabaseModule` (system transaction
 * runner), `MessagingModule` and `OutboxModule` (consumers and deduplicator) and `JobsModule`. The
 * templates are loaded when the module is built: missing ones stop the start-up.
 */
@Module({
  providers: [
    { provide: CLOCK, useClass: SystemClock },
    { provide: CODE_EMAIL_UNIT_OF_WORK, useClass: SystemCodeEmailUnitOfWork },
    { provide: CODE_EMAIL_DELIVERIES, useClass: DrizzleCodeEmailDeliveryRepository },
    { provide: CODE_EMAIL_QUEUE, useClass: JobsCodeEmailQueue },
    {
      provide: EMAIL_RENDERER,
      inject: [CONFIG],
      useFactory: (config: AppConfig): Promise<EmailRenderer> =>
        HandlebarsEmailRenderer.load(config.WEB_APP_URL),
    },
    {
      provide: EMAIL_SENDER,
      inject: [CONFIG],
      useFactory: (config: AppConfig): EmailSender =>
        new NodemailerEmailSender({
          host: config.SMTP_HOST,
          port: config.SMTP_PORT,
          user: config.SMTP_USER,
          password: config.SMTP_PASSWORD,
          from: config.MAIL_FROM,
          webAppUrl: config.WEB_APP_URL,
        }),
    },
    {
      provide: RequestCodeEmail,
      inject: [CODE_EMAIL_UNIT_OF_WORK, CODE_EMAIL_DELIVERIES, CODE_EMAIL_QUEUE, CLOCK],
      useFactory: (
        unitOfWork: CodeEmailUnitOfWork,
        deliveries: CodeEmailDeliveries,
        queue: CodeEmailQueue,
        clock: Clock,
      ): RequestCodeEmail => new RequestCodeEmail(unitOfWork, deliveries, queue, clock),
    },
    {
      provide: SendCodeEmail,
      inject: [CODE_EMAIL_UNIT_OF_WORK, CODE_EMAIL_DELIVERIES, EMAIL_RENDERER, EMAIL_SENDER, CLOCK],
      useFactory: (
        unitOfWork: CodeEmailUnitOfWork,
        deliveries: CodeEmailDeliveries,
        renderer: EmailRenderer,
        sender: EmailSender,
        clock: Clock,
      ): SendCodeEmail => new SendCodeEmail(unitOfWork, deliveries, renderer, sender, clock),
    },
    {
      provide: ExpireCodeEmails,
      inject: [CODE_EMAIL_UNIT_OF_WORK, CODE_EMAIL_DELIVERIES, CLOCK],
      useFactory: (
        unitOfWork: CodeEmailUnitOfWork,
        deliveries: CodeEmailDeliveries,
        clock: Clock,
      ): ExpireCodeEmails => new ExpireCodeEmails(unitOfWork, deliveries, clock),
    },
    OneTimeCodeIssuedHandler,
    SendCodeEmailHandler,
    ExpireCodeEmailsHandler,
  ],
})
export class EmailModule {}
