import { CONFIG, ProblemException, toProblem } from '@cadenway/nest-common';
import { Idempotent, TenantTransactionRunner } from '@cadenway/nest-common/database';
import { JobsService } from '@cadenway/nest-jobs';
import { Module } from '@nestjs/common';
import type { NestExpressApplication } from '@nestjs/platform-express';
import type { NextFunction, Request, Response } from 'express';
import type { AppConfig } from '../../config/app-config.js';
import { RETRY_INBOX_DELIVERY_AUTHORIZATION_QUEUE } from '../../config/job-queues.js';
import { ActivityDigestsModule } from '../activity-digests/activity-digests.module.js';
import { StageActivityEmail } from '../activity-digests/public/digest/stage-activity-email.js';
import { IsInAppNotificationEnabled } from '../notification-preferences/public/preferences/is-in-app-notification-enabled.js';

import { AcceptInboxDeliveryAuthorization } from './application/use-cases/commands/inbox/accept-inbox-delivery-authorization/accept-inbox-delivery-authorization.use-case.js';
import type { InboxCandidatesReader } from './application/ports/outbound/persistence/inbox/inbox-candidates-reader.port.js';
import { ArchiveCheckedNotification } from './application/use-cases/commands/inbox/archive-checked-notification/archive-checked-notification.use-case.js';
import { ReadCheckedNotification } from './application/use-cases/commands/inbox/read-checked-notification/read-checked-notification.use-case.js';
import { ReadSelectedNotifications } from './application/use-cases/commands/inbox/read-selected-notifications/read-selected-notifications.use-case.js';
import { RecordBillingNotice } from './application/use-cases/commands/inbox/record-billing-notice/record-billing-notice.use-case.js';
import { RetryInboxDeliveryAuthorization } from './application/use-cases/commands/inbox/retry-inbox-delivery-authorization/retry-inbox-delivery-authorization.use-case.js';
import { StageInboxDeliveries } from './application/use-cases/commands/inbox/stage-inbox-deliveries/stage-inbox-deliveries.use-case.js';
import { StageTaskNotificationFact } from './application/use-cases/commands/inbox/stage-task-notification-fact/stage-task-notification-fact.use-case.js';
import { GetInboxCandidate } from './application/use-cases/queries/inbox/get-inbox-candidate/get-inbox-candidate.use-case.js';
import { ListInboxCandidates } from './application/use-cases/queries/inbox/list-inbox-candidates/list-inbox-candidates.use-case.js';
import { ListUnreadSubjects } from './application/use-cases/queries/inbox/list-unread-subjects/list-unread-subjects.use-case.js';
import { authorizeAutomationNotificationProvider } from './composition/providers/use-cases/inbox/authorize-automation-notification.provider.js';
import { recordAutomationNotificationProvider } from './composition/providers/use-cases/inbox/record-automation-notification.provider.js';
import { recordBillingNoticeProvider } from './composition/providers/use-cases/inbox/record-billing-notice.provider.js';
import { InboxDeliveryOutbox } from './infrastructure/messaging/outbox/inbox/inbox-delivery-outbox.adapter.js';
import { DrizzleInboxDeliveryUnitOfWork } from './infrastructure/persistence/drizzle/transactions/inbox/drizzle-inbox-delivery.unit-of-work.js';
import { DrizzleInboxRecordsUnitOfWork } from './infrastructure/persistence/drizzle/transactions/inbox/drizzle-inbox-records.unit-of-work.js';
import { InboxController } from './presentation/http/controllers/inbox/inbox.controller.js';
import { AutomationNotificationController } from './presentation/http/controllers/inbox/automation-notification.controller.js';
import { AutomationNotificationAccessGuard } from './presentation/http/guards/inbox/automation-notification-access.guard.js';
import { RetryInboxDeliveryAuthorizationHandler } from './presentation/jobs/handlers/inbox/retry-inbox-delivery-authorization.handler.js';
import { TaskInboxEventsHandler } from './presentation/messaging/handlers/task/task-inbox-events.handler.js';

/** The verified tenant reader shared by the three Inbox queries. */
const INBOX_CANDIDATES_READER: symbol = Symbol('INBOX_CANDIDATES_READER');
const automationNotificationPath = /^\/internal\/v1\/inbox\/automation-notifications\/?$/iu;

/** Attaches the kit's transaction-bound receipt to the authorized command. */
function markAutomationNotificationIdempotent(): void {
  const prototype = AutomationNotificationController.prototype;
  const descriptor = Object.getOwnPropertyDescriptor(prototype, 'create');
  if (descriptor === undefined) throw new Error('Missing automation notification command handler.');
  Idempotent({ required: true, scope: 'actor' })(prototype, 'create', descriptor);
}
markAutomationNotificationIdempotent();

/** Composition boundary for the recipient inbox in the selected organization. */
@Module({
  imports: [ActivityDigestsModule],
  controllers: [InboxController, AutomationNotificationController],
  providers: [
    InboxDeliveryOutbox,
    AutomationNotificationAccessGuard,
    authorizeAutomationNotificationProvider,
    recordAutomationNotificationProvider,
    recordBillingNoticeProvider,
    {
      provide: DrizzleInboxRecordsUnitOfWork,
      inject: [TenantTransactionRunner, InboxDeliveryOutbox],
      useFactory: (
        runner: TenantTransactionRunner,
        outbox: InboxDeliveryOutbox,
      ): DrizzleInboxRecordsUnitOfWork =>
        new DrizzleInboxRecordsUnitOfWork(runner, (scope, fact, subject) =>
          outbox.recordCreated(scope, fact, subject),
        ),
    },
    {
      provide: INBOX_CANDIDATES_READER,
      inject: [DrizzleInboxRecordsUnitOfWork],
      useFactory: (work: DrizzleInboxRecordsUnitOfWork): InboxCandidatesReader => ({
        pageCandidates: (organizationId, ...rest) =>
          work.read(organizationId, (records) => records.pageCandidates(organizationId, ...rest)),
        findCandidate: (organizationId, ...rest) =>
          work.read(organizationId, (records) => records.findCandidate(organizationId, ...rest)),
        unreadSubjects: (organizationId, ...rest) =>
          work.read(organizationId, (records) => records.unreadSubjects(organizationId, ...rest)),
      }),
    },
    {
      provide: ListInboxCandidates,
      inject: [INBOX_CANDIDATES_READER],
      useFactory: (reader: InboxCandidatesReader): ListInboxCandidates =>
        new ListInboxCandidates(reader),
    },
    {
      provide: GetInboxCandidate,
      inject: [INBOX_CANDIDATES_READER],
      useFactory: (reader: InboxCandidatesReader): GetInboxCandidate =>
        new GetInboxCandidate(reader),
    },
    {
      provide: ListUnreadSubjects,
      inject: [INBOX_CANDIDATES_READER],
      useFactory: (reader: InboxCandidatesReader): ListUnreadSubjects =>
        new ListUnreadSubjects(reader),
    },
    {
      provide: ReadCheckedNotification,
      inject: [DrizzleInboxRecordsUnitOfWork],
      useFactory: (work: DrizzleInboxRecordsUnitOfWork): ReadCheckedNotification =>
        new ReadCheckedNotification(work, Date.now),
    },
    {
      provide: ArchiveCheckedNotification,
      inject: [DrizzleInboxRecordsUnitOfWork],
      useFactory: (work: DrizzleInboxRecordsUnitOfWork): ArchiveCheckedNotification =>
        new ArchiveCheckedNotification(work, Date.now),
    },
    {
      provide: ReadSelectedNotifications,
      inject: [DrizzleInboxRecordsUnitOfWork],
      useFactory: (work: DrizzleInboxRecordsUnitOfWork): ReadSelectedNotifications =>
        new ReadSelectedNotifications(work, Date.now),
    },
    {
      provide: DrizzleInboxDeliveryUnitOfWork,
      inject: [TenantTransactionRunner, InboxDeliveryOutbox, JobsService],
      useFactory: (
        runner: TenantTransactionRunner,
        outbox: InboxDeliveryOutbox,
        jobs: JobsService,
      ): DrizzleInboxDeliveryUnitOfWork =>
        new DrizzleInboxDeliveryUnitOfWork(
          runner,
          (scope, attempt) => outbox.recordRequest(scope, attempt),
          (scope, fact, subject) => outbox.recordCreated(scope, fact, subject),
          async (scope, { attemptId, retryCount, runAt }) => {
            await jobs.enqueue(
              scope,
              RETRY_INBOX_DELIVERY_AUTHORIZATION_QUEUE,
              { attemptId, retryCount },
              { occurrenceKey: attemptId, startAfter: new Date(runAt) },
            );
          },
        ),
    },
    {
      provide: StageInboxDeliveries,
      inject: [DrizzleInboxDeliveryUnitOfWork],
      useFactory: (work: DrizzleInboxDeliveryUnitOfWork): StageInboxDeliveries =>
        new StageInboxDeliveries(work, Date.now),
    },
    {
      provide: AcceptInboxDeliveryAuthorization,
      inject: [DrizzleInboxDeliveryUnitOfWork, IsInAppNotificationEnabled],
      useFactory: (
        work: DrizzleInboxDeliveryUnitOfWork,
        preferences: IsInAppNotificationEnabled,
      ): AcceptInboxDeliveryAuthorization =>
        new AcceptInboxDeliveryAuthorization(work, Date.now, (recipientId, kind) =>
          kind === 'approval'
            ? Promise.resolve(true)
            : preferences.execute({
                userId: recipientId,
                category: kind === 'status-change' ? 'statusChange' : kind,
              }),
        ),
    },
    {
      provide: StageTaskNotificationFact,
      inject: [StageInboxDeliveries, StageActivityEmail, CONFIG],
      useFactory: (
        stageInbox: StageInboxDeliveries,
        stageActivity: StageActivityEmail,
        config: AppConfig,
      ): StageTaskNotificationFact =>
        new StageTaskNotificationFact(stageInbox, {
          stage: (input) =>
            config.IDENTITY_SERVICE_URL === undefined
              ? Promise.resolve(0)
              : stageActivity.execute(input),
        }),
    },
    TaskInboxEventsHandler,
    {
      provide: RetryInboxDeliveryAuthorization,
      inject: [DrizzleInboxDeliveryUnitOfWork],
      useFactory: (work: DrizzleInboxDeliveryUnitOfWork): RetryInboxDeliveryAuthorization =>
        new RetryInboxDeliveryAuthorization(work, Date.now),
    },
    {
      provide: RetryInboxDeliveryAuthorizationHandler,
      inject: [JobsService, RetryInboxDeliveryAuthorization],
      useFactory: (
        jobs: JobsService,
        retry: RetryInboxDeliveryAuthorization,
      ): RetryInboxDeliveryAuthorizationHandler =>
        new RetryInboxDeliveryAuthorizationHandler(
          jobs,
          retry,
          RETRY_INBOX_DELIVERY_AUTHORIZATION_QUEUE,
        ),
    },
  ],
  exports: [RecordBillingNotice],
})
export class InboxModule {
  // #region Methods
  /** Marks the command private even when authentication or JSON parsing stops it early. */
  public static registerAutomationNotificationPrivacy(
    app: Pick<NestExpressApplication, 'use'>,
  ): void {
    app.use(
      automationNotificationPath,
      (_request: Request, response: Response, next: NextFunction) => {
        response.setHeader('Cache-Control', 'private, no-store');
        next();
      },
    );
    app.use(
      automationNotificationPath,
      (error: unknown, _request: Request, response: Response, next: NextFunction) => {
        response.setHeader('Cache-Control', 'private, no-store');
        const problem = toProblem(error);
        if (problem.status !== 400 || problem.code === 'request.invalid') {
          next(error);
          return;
        }
        next(
          new ProblemException({
            status: 400,
            code: 'request.invalid',
            details: { issues: [{ in: 'body', path: '', code: 'invalid_format' }] },
          }),
        );
      },
    );
  }
  // #endregion
}
