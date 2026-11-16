import { Module } from '@nestjs/common';
import type { DynamicModule, Provider } from '@nestjs/common';
import type { NotificationProcessRole } from '../../config/notification-process-role.js';
import { OneTimeCodeIssuedHandler } from './presentation/messaging/handlers/identity/one-time-code-issued.handler.js';
import { clockProvider } from './composition/providers/adapters/code-email/clock.provider.js';
import { codeEmailUnitOfWorkProvider } from './composition/providers/adapters/code-email/code-email-unit-of-work.provider.js';
import { codeEmailDeliveriesProvider } from './composition/providers/adapters/code-email/code-email-deliveries.provider.js';
import { codeEmailQueueProvider } from './composition/providers/adapters/code-email/code-email-queue.provider.js';
import { emailRendererProvider } from './composition/providers/adapters/code-email/email-renderer.provider.js';
import { emailSenderProvider } from './composition/providers/adapters/code-email/email-sender.provider.js';
import { requestCodeEmailProvider } from './composition/providers/use-cases/code-email/request-code-email.provider.js';
import { sendCodeEmailProvider } from './composition/providers/use-cases/code-email/send-code-email.provider.js';
import { expireCodeEmailsProvider } from './composition/providers/use-cases/code-email/expire-code-emails.provider.js';
import { sendCodeEmailHandlerProvider } from './composition/providers/adapters/code-email/send-code-email-handler.provider.js';
import { expireCodeEmailsHandlerProvider } from './composition/providers/adapters/code-email/expire-code-emails-handler.provider.js';
import { expireCodeEmailsScheduleHandlerProvider } from './composition/providers/adapters/code-email/expire-code-emails-schedule-handler.provider.js';

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
@Module({})
export class EmailModule {
  // #region Methods
  /**
   * Selects the producer and scheduling providers, worker providers, or both for this process.
   *
   * @param {NotificationProcessRole} role - Notification process composition.
   * @returns {DynamicModule} Email module with the selected capabilities.
   */
  public static forRole(role: NotificationProcessRole): DynamicModule {
    const providers: Provider[] = [
      clockProvider,
      codeEmailUnitOfWorkProvider,
      codeEmailDeliveriesProvider,
    ];
    if (role !== 'worker') {
      providers.push(
        codeEmailQueueProvider,
        requestCodeEmailProvider,
        OneTimeCodeIssuedHandler,
        expireCodeEmailsScheduleHandlerProvider,
      );
    }
    if (role !== 'api') {
      providers.push(
        emailRendererProvider,
        emailSenderProvider,
        sendCodeEmailProvider,
        expireCodeEmailsProvider,
        sendCodeEmailHandlerProvider,
        expireCodeEmailsHandlerProvider,
      );
    }
    return { module: EmailModule, providers };
  }
  // #endregion
}
