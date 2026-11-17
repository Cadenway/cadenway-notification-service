import { JobsService } from '@cadenway/nest-jobs';
import type { FactoryProvider } from '@nestjs/common';
import {
  EXPIRE_SECURITY_EMAILS_CRON,
  EXPIRE_SECURITY_EMAILS_QUEUE,
} from '../../../../../../config/job-queues.js';
import { ExpireSecurityEmails } from '../../../../application/use-cases/commands/security-email/expire-security-emails/expire-security-emails.use-case.js';
import { ExpireSecurityEmailsHandler } from '../../../../presentation/jobs/handlers/security-email/expire-security-emails.handler.js';

/**
 * Constant expireSecurityEmailsHandlerProvider
 *
 * @description
 * Registers the sweep of the security e-mails with its declared queue and schedule.
 *
 * @type {FactoryProvider<ExpireSecurityEmailsHandler>}
 */
export const expireSecurityEmailsHandlerProvider: FactoryProvider<ExpireSecurityEmailsHandler> = {
  provide: ExpireSecurityEmailsHandler,
  inject: [JobsService, ExpireSecurityEmails],
  useFactory: (jobs: JobsService, useCase: ExpireSecurityEmails): ExpireSecurityEmailsHandler =>
    new ExpireSecurityEmailsHandler(
      jobs,
      useCase,
      EXPIRE_SECURITY_EMAILS_QUEUE,
      EXPIRE_SECURITY_EMAILS_CRON,
    ),
};
