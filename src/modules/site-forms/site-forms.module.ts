import { CONFIG, ProblemException, toProblem } from '@cadenway/nest-common';
import { SystemTransactionRunner } from '@cadenway/nest-common/database';
import type { TransactionScope } from '@cadenway/nest-common/database';
import { JobsService } from '@cadenway/nest-jobs';
import { Module } from '@nestjs/common';
import type { NestExpressApplication } from '@nestjs/platform-express';
import type { NextFunction, Request, Response } from 'express';

import type { AppConfig } from '../../config/app-config.js';
import {
  RECOVER_SITE_CONTACT_CRON,
  RECOVER_SITE_CONTACT_QUEUE,
  SEND_SITE_CONTACT_EMAIL_MAX_ATTEMPTS,
  SEND_SITE_CONTACT_EMAIL_QUEUE,
} from '../../config/job-queues.js';
import { EmailModule } from '../email/email.module.js';
import { SendSiteContactEmail } from '../email/public/site-contact/send-site-contact-email.js';
import { DeliverContact } from './application/use-cases/commands/delivery/deliver-contact/deliver-contact.use-case.js';
import { SubscribeNewsletter } from './application/use-cases/commands/forms/subscribe-newsletter/subscribe-newsletter.use-case.js';
import { SubmitContact } from './application/use-cases/commands/forms/submit-contact/submit-contact.use-case.js';
import { RecoverContactSubmissions } from './application/use-cases/commands/recovery/recover-contact-submissions/recover-contact-submissions.use-case.js';
import { DrizzleContactDeliveryRepository } from './infrastructure/persistence/drizzle/repositories/delivery/drizzle-contact-delivery.repository.js';
import { SystemContactSubmissionUnitOfWork } from './infrastructure/persistence/drizzle/transactions/forms/system-contact-submission.unit-of-work.js';
import { SystemNewsletterSubscriptionUnitOfWork } from './infrastructure/persistence/drizzle/transactions/forms/system-newsletter-subscription.unit-of-work.js';
import { SystemContactRecoveryUnitOfWork } from './infrastructure/persistence/drizzle/transactions/recovery/system-contact-recovery.unit-of-work.js';
import {
  SITE_CONTACT_ENABLED,
  SiteFormsController,
} from './presentation/http/controllers/forms/site-forms.controller.js';
import { DeliverContactJobHandler } from './presentation/jobs/handlers/delivery/deliver-contact-job.handler.js';
import { RecoverContactSubmissionsHandler } from './presentation/jobs/handlers/recovery/recover-contact-submissions.handler.js';

const siteSubmissionPath =
  /^\/internal\/v1\/(?:contact-submissions|newsletter-subscriptions)\/?$/iu;

/** Uses the same stable job occurrence for first admission and recovery. */
function sendContactEnqueuer(jobs: JobsService) {
  return async (scope: TransactionScope, submissionId: string): Promise<void> => {
    await jobs.enqueue(
      scope,
      SEND_SITE_CONTACT_EMAIL_QUEUE,
      { submissionId },
      {
        occurrenceKey: submissionId,
      },
    );
  };
}

/** Composes the signed Site command handlers with system-scoped persistence. */
@Module({
  imports: [EmailModule],
  controllers: [SiteFormsController],
  providers: [
    {
      provide: SITE_CONTACT_ENABLED,
      inject: [CONFIG],
      useFactory: (config: AppConfig): boolean => config.SITE_CONTACT_SUPPORT_ADDRESS !== undefined,
    },
    {
      provide: SubmitContact,
      inject: [SystemTransactionRunner, JobsService],
      useFactory: (system: SystemTransactionRunner, jobs: JobsService): SubmitContact =>
        new SubmitContact(new SystemContactSubmissionUnitOfWork(system, sendContactEnqueuer(jobs))),
    },
    {
      provide: SubscribeNewsletter,
      inject: [SystemTransactionRunner],
      useFactory: (system: SystemTransactionRunner): SubscribeNewsletter =>
        new SubscribeNewsletter(new SystemNewsletterSubscriptionUnitOfWork(system)),
    },
    {
      provide: DeliverContact,
      inject: [SystemTransactionRunner, SendSiteContactEmail, CONFIG],
      useFactory: (
        system: SystemTransactionRunner,
        email: SendSiteContactEmail,
        config: AppConfig,
      ): DeliverContact =>
        new DeliverContact(
          new DrizzleContactDeliveryRepository(system),
          { send: (input) => email.execute(input) },
          config.SITE_CONTACT_SUPPORT_ADDRESS,
        ),
    },
    {
      provide: DeliverContactJobHandler,
      inject: [JobsService, DeliverContact],
      useFactory: (jobs: JobsService, delivery: DeliverContact): DeliverContactJobHandler =>
        new DeliverContactJobHandler(
          jobs,
          delivery,
          SEND_SITE_CONTACT_EMAIL_QUEUE,
          SEND_SITE_CONTACT_EMAIL_MAX_ATTEMPTS,
        ),
    },
    {
      provide: RecoverContactSubmissions,
      inject: [SystemTransactionRunner, JobsService, CONFIG],
      useFactory: (
        system: SystemTransactionRunner,
        jobs: JobsService,
        config: AppConfig,
      ): RecoverContactSubmissions =>
        new RecoverContactSubmissions(
          new SystemContactRecoveryUnitOfWork(system, sendContactEnqueuer(jobs)),
          config.SITE_CONTACT_SUPPORT_ADDRESS !== undefined,
        ),
    },
    {
      provide: RecoverContactSubmissionsHandler,
      inject: [JobsService, RecoverContactSubmissions],
      useFactory: (
        jobs: JobsService,
        recovery: RecoverContactSubmissions,
      ): RecoverContactSubmissionsHandler =>
        new RecoverContactSubmissionsHandler(
          jobs,
          recovery,
          RECOVER_SITE_CONTACT_QUEUE,
          RECOVER_SITE_CONTACT_CRON,
        ),
    },
  ],
})
export class SiteFormsModule {
  // #region Methods
  /** Registers Site privacy headers for route responses and shared-parser refusals. */
  public static registerRequestPrivacy(app: Pick<NestExpressApplication, 'use'>): void {
    app.use(
      siteSubmissionPath,
      (_request: Request, response: Response, next: NextFunction): void => {
        response.setHeader('Cache-Control', 'private, no-store');
        next();
      },
    );
    app.use(
      siteSubmissionPath,
      (error: unknown, _request: Request, response: Response, next: NextFunction): void => {
        response.setHeader('Cache-Control', 'private, no-store');
        const problem = toProblem(error);
        if (problem.status === 400 && problem.code !== 'request.invalid') {
          next(
            new ProblemException({
              status: 400,
              code: 'request.invalid',
              details: { issues: [{ in: 'body', path: '', code: 'invalid_format' }] },
            }),
          );
          return;
        }
        next(error);
      },
    );
  }
  // #endregion
}
