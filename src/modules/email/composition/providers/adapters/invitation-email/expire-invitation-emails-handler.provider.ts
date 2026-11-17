import { JobsService } from '@cadenway/nest-jobs';
import type { FactoryProvider } from '@nestjs/common';
import {
  EXPIRE_INVITATION_EMAILS_CRON,
  EXPIRE_INVITATION_EMAILS_QUEUE,
} from '../../../../../../config/job-queues.js';
import { ExpireInvitationEmails } from '../../../../application/use-cases/commands/invitation-email/expire-invitation-emails/expire-invitation-emails.use-case.js';
import { ExpireInvitationEmailsHandler } from '../../../../presentation/jobs/handlers/invitation-email/expire-invitation-emails.handler.js';

/**
 * Constant expireInvitationEmailsHandlerProvider
 *
 * @description
 * Registers the sweep of the invitation e-mails with its declared queue and schedule.
 *
 * @type {FactoryProvider<ExpireInvitationEmailsHandler>}
 */
export const expireInvitationEmailsHandlerProvider: FactoryProvider<ExpireInvitationEmailsHandler> =
  {
    provide: ExpireInvitationEmailsHandler,
    inject: [JobsService, ExpireInvitationEmails],
    useFactory: (
      jobs: JobsService,
      useCase: ExpireInvitationEmails,
    ): ExpireInvitationEmailsHandler =>
      new ExpireInvitationEmailsHandler(
        jobs,
        useCase,
        EXPIRE_INVITATION_EMAILS_QUEUE,
        EXPIRE_INVITATION_EMAILS_CRON,
      ),
  };
