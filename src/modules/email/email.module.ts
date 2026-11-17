import { Module } from '@nestjs/common';
import { OneTimeCodeIssuedHandler } from './presentation/messaging/handlers/identity/one-time-code-issued.handler.js';
import { InvitationIssuedHandler } from './presentation/messaging/handlers/organization/invitation-issued.handler.js';
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
import { invitationEmailUnitOfWorkProvider } from './composition/providers/adapters/invitation-email/invitation-email-unit-of-work.provider.js';
import { invitationEmailSweepUnitOfWorkProvider } from './composition/providers/adapters/invitation-email/invitation-email-sweep-unit-of-work.provider.js';
import { invitationEmailDeliveriesProvider } from './composition/providers/adapters/invitation-email/invitation-email-deliveries.provider.js';
import { invitationEmailQueueProvider } from './composition/providers/adapters/invitation-email/invitation-email-queue.provider.js';
import { invitationEmailRendererProvider } from './composition/providers/adapters/invitation-email/invitation-email-renderer.provider.js';
import { requestInvitationEmailProvider } from './composition/providers/use-cases/invitation-email/request-invitation-email.provider.js';
import { sendInvitationEmailProvider } from './composition/providers/use-cases/invitation-email/send-invitation-email.provider.js';
import { expireInvitationEmailsProvider } from './composition/providers/use-cases/invitation-email/expire-invitation-emails.provider.js';
import { sendInvitationEmailHandlerProvider } from './composition/providers/adapters/invitation-email/send-invitation-email-handler.provider.js';
import { expireInvitationEmailsHandlerProvider } from './composition/providers/adapters/invitation-email/expire-invitation-emails-handler.provider.js';

/**
 * Class EmailModule
 *
 * @description
 * The e-mails of the service. In this version:
 *
 * - the two e-mails that carry a single-use code: `one-time-code.issued.v1` of identity-service,
 *   read from `EVENTS_RESTRICTED`, becomes a delivery of the send log and a durable job, which
 *   renders the template compiled at build time and sends it through the SMTP server of the
 *   configuration; a scheduled sweep settles the deliveries whose code expired before they could
 *   leave;
 * - the "Invitation" e-mail: `invitation.issued.v1` of organization-service, read from `EVENTS`,
 *   follows the same path in the tenant transactions of its organization, with its own send log,
 *   job and hourly sweep.
 *
 * See its `MODULE.md`. It relies on the global modules of `AppModule`: `CONFIG`, `DatabaseModule`
 * (tenant and system transaction runners), `MessagingModule` and `OutboxModule` (consumers and
 * deduplicator) and `JobsModule`. The templates are loaded when the module is built: missing ones
 * stop the start-up.
 */
@Module({
  providers: [
    clockProvider,
    codeEmailUnitOfWorkProvider,
    codeEmailDeliveriesProvider,
    codeEmailQueueProvider,
    emailRendererProvider,
    emailSenderProvider,
    requestCodeEmailProvider,
    sendCodeEmailProvider,
    expireCodeEmailsProvider,
    OneTimeCodeIssuedHandler,
    sendCodeEmailHandlerProvider,
    expireCodeEmailsHandlerProvider,
    invitationEmailUnitOfWorkProvider,
    invitationEmailSweepUnitOfWorkProvider,
    invitationEmailDeliveriesProvider,
    invitationEmailQueueProvider,
    invitationEmailRendererProvider,
    requestInvitationEmailProvider,
    sendInvitationEmailProvider,
    expireInvitationEmailsProvider,
    InvitationIssuedHandler,
    sendInvitationEmailHandlerProvider,
    expireInvitationEmailsHandlerProvider,
  ],
})
export class EmailModule {}
