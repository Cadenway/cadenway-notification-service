import { JobWorkerRegistry } from '@cadenway/nest-jobs/runtime';
import type { FactoryProvider } from '@nestjs/common';
import { ExpireCodeEmailsHandler } from '../../../../presentation/jobs/handlers/code-email/expire-code-emails.handler.js';
import { ExpireCodeEmails } from '../../../../application/use-cases/commands/code-email/expire-code-emails/expire-code-emails.use-case.js';
import { EXPIRE_CODE_EMAILS_QUEUE } from '../../../../../../config/job-queues.js';

/**
 * Constant expireCodeEmailsHandlerProvider
 *
 * @description
 * Registers the expiry worker with its declared queue.
 *
 * @type {FactoryProvider<ExpireCodeEmailsHandler>}
 */
export const expireCodeEmailsHandlerProvider: FactoryProvider<ExpireCodeEmailsHandler> = {
  provide: ExpireCodeEmailsHandler,
  inject: [JobWorkerRegistry, ExpireCodeEmails],
  useFactory: (jobs: JobWorkerRegistry, useCase: ExpireCodeEmails): ExpireCodeEmailsHandler =>
    new ExpireCodeEmailsHandler(jobs, useCase, EXPIRE_CODE_EMAILS_QUEUE),
};
