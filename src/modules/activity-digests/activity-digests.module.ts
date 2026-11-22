import { CONFIG, InternalTokenSigner } from '@cadenway/nest-common';
import {
  SystemTransactionRunner,
  TenantTransactionRunner,
  type TransactionScope,
} from '@cadenway/nest-common/database';
import { JobsService } from '@cadenway/nest-jobs';
import { EventConsumers } from '@cadenway/nest-messaging';
import { Module } from '@nestjs/common';

import type { AppConfig } from '../../config/app-config.js';
import { PLAN_ACTIVITY_EMAIL_QUEUE, SEND_ACTIVITY_EMAIL_QUEUE } from '../../config/job-queues.js';
import { EmailModule } from '../email/email.module.js';
import { SendActivityNotice } from '../email/public/activity-notice/send-activity-notice.js';
import { NotificationPreferencesModule } from '../notification-preferences/notification-preferences.module.js';
import {
  ReadActivityPreferences,
  type ReadActivityPreferencesOutput,
} from '../notification-preferences/public/preferences/read-activity-preferences.js';
import type { ActivityEmailPreferences } from './application/models/digest/activity-email-preferences.model.js';
import type { ActivityEmailSender } from './application/ports/outbound/email/digest/activity-email-sender.port.js';
import type { ActivityRecipientReader } from './application/ports/outbound/identity/digest/activity-recipient-reader.port.js';
import { AcceptActivityAuthorization } from './application/use-cases/commands/digest/accept-activity-authorization/accept-activity-authorization.use-case.js';
import { PlanActivityEmail } from './application/use-cases/commands/digest/plan-activity-email/plan-activity-email.use-case.js';
import { RequestActivityAuthorization } from './application/use-cases/commands/digest/request-activity-authorization/request-activity-authorization.use-case.js';
import { SendActivityEmail } from './application/use-cases/commands/digest/send-activity-email/send-activity-email.use-case.js';
import { StageActivityEmail } from './application/use-cases/commands/digest/stage-activity-email/stage-activity-email.use-case.js';
import { ListDueActivityOrganizations } from './application/use-cases/queries/digest/list-due-activity-organizations/list-due-activity-organizations.use-case.js';
import { activityEmailSender } from './infrastructure/adapters/email/activity-email-sender.adapter.js';
import { createActivityRecipientReader } from './infrastructure/adapters/identity/digest/identity-activity-recipient-reader.adapter.js';
import { ActivityAuthorizationOutbox } from './infrastructure/messaging/outbox/digest/activity-authorization-outbox.adapter.js';
import { DrizzleActivityDigestQueries } from './infrastructure/persistence/drizzle/repositories/digest/drizzle-activity-digest-queries.repository.js';
import { DrizzleActivityDigestUnitOfWork } from './infrastructure/persistence/drizzle/transactions/digest/drizzle-activity-digest.unit-of-work.js';
import { ActivityEmailJobsHandler } from './presentation/jobs/handlers/digest/activity-email-jobs.handler.js';
import { ActivityAuthorizationHandler } from './presentation/messaging/handlers/task/activity-authorization.handler.js';

const RECIPIENT_READER = Symbol('ACTIVITY_RECIPIENT_READER');
const EMAIL_SENDER = Symbol('ACTIVITY_EMAIL_SENDER');

/** Translates the preferences owner's account snapshot into email intake and scheduling choices. */
function emailPreferences({
  channels,
  digest,
  version,
}: ReadActivityPreferencesOutput): ActivityEmailPreferences {
  return {
    version,
    cadence: digest,
    enabled: {
      assignment: channels.assignment.email,
      comment: channels.comment.email,
      mention: channels.mention.email,
      'status-change': channels.statusChange.email,
      access: channels.access.email,
      approval: false,
    },
  };
}

/** Composition boundary for scheduled activity email. */
@Module({
  imports: [EmailModule, NotificationPreferencesModule],
  providers: [
    ActivityAuthorizationOutbox,
    {
      provide: RECIPIENT_READER,
      inject: [CONFIG],
      useFactory: async ({
        IDENTITY_SERVICE_URL,
        INTERNAL_TOKEN_PRIVATE_JWK,
      }: AppConfig): Promise<ActivityRecipientReader> => {
        if (IDENTITY_SERVICE_URL === undefined || INTERNAL_TOKEN_PRIVATE_JWK === undefined)
          return { findCurrent: () => Promise.resolve(null) };
        return createActivityRecipientReader({
          baseUrl: IDENTITY_SERVICE_URL,
          signer: await InternalTokenSigner.create({
            issuer: 'notification-service',
            privateJwk: INTERNAL_TOKEN_PRIVATE_JWK,
          }),
        });
      },
    },
    { provide: EMAIL_SENDER, inject: [SendActivityNotice], useFactory: activityEmailSender },
    {
      provide: DrizzleActivityDigestUnitOfWork,
      inject: [
        TenantTransactionRunner,
        SystemTransactionRunner,
        ReadActivityPreferences,
        JobsService,
        ActivityAuthorizationOutbox,
      ],
      useFactory: (
        tenant: TenantTransactionRunner,
        system: SystemTransactionRunner,
        preferences: ReadActivityPreferences<TransactionScope>,
        jobs: JobsService,
        outbox: ActivityAuthorizationOutbox,
      ): DrizzleActivityDigestUnitOfWork =>
        new DrizzleActivityDigestUnitOfWork(tenant, system, {
          readPreferences: async (scope, userId) =>
            emailPreferences(await preferences.execute(scope, userId)),
          readIntakePreferences: async (scope, userIds) => {
            const snapshots = await preferences.executeForRecipients(scope, userIds);
            return new Map(
              [...snapshots].map(([userId, snapshot]) => [userId, emailPreferences(snapshot)]),
            );
          },
          enqueuePlan: async (scope, { runAt, ...job }) => {
            await jobs.enqueue(
              scope,
              PLAN_ACTIVITY_EMAIL_QUEUE,
              job,
              runAt === undefined
                ? undefined
                : {
                    occurrenceKey: `${job.userId}:${String(runAt)}`,
                    startAfter: new Date(runAt),
                  },
            );
          },
          enqueueDelivery: async (scope, { runAt, ...job }) => {
            await jobs.enqueue(scope, SEND_ACTIVITY_EMAIL_QUEUE, job, {
              occurrenceKey: `${job.occurrenceId}:${String(job.generation)}`,
              startAfter: new Date(runAt),
            });
          },
          writeAuthorization: (scope, request) => outbox.append(scope, request),
        }),
    },
    {
      provide: DrizzleActivityDigestQueries,
      inject: [SystemTransactionRunner],
      useFactory: (system: SystemTransactionRunner): DrizzleActivityDigestQueries =>
        new DrizzleActivityDigestQueries(system),
    },
    {
      provide: ListDueActivityOrganizations,
      inject: [DrizzleActivityDigestQueries],
      useFactory: (queries: DrizzleActivityDigestQueries): ListDueActivityOrganizations =>
        new ListDueActivityOrganizations(queries),
    },
    {
      provide: StageActivityEmail,
      inject: [DrizzleActivityDigestUnitOfWork],
      useFactory: (work: DrizzleActivityDigestUnitOfWork): StageActivityEmail =>
        new StageActivityEmail(work.email),
    },
    {
      provide: PlanActivityEmail,
      inject: [RECIPIENT_READER, DrizzleActivityDigestUnitOfWork],
      useFactory: (
        recipients: ActivityRecipientReader,
        work: DrizzleActivityDigestUnitOfWork,
      ): PlanActivityEmail => new PlanActivityEmail(recipients, work.email),
    },
    {
      provide: RequestActivityAuthorization,
      inject: [DrizzleActivityDigestUnitOfWork],
      useFactory: (work: DrizzleActivityDigestUnitOfWork): RequestActivityAuthorization =>
        new RequestActivityAuthorization(work.delivery, Date.now),
    },
    {
      provide: AcceptActivityAuthorization,
      inject: [DrizzleActivityDigestUnitOfWork],
      useFactory: (work: DrizzleActivityDigestUnitOfWork): AcceptActivityAuthorization =>
        new AcceptActivityAuthorization(work.delivery, Date.now),
    },
    {
      provide: ActivityAuthorizationHandler,
      inject: [EventConsumers, AcceptActivityAuthorization, CONFIG],
      useFactory: (
        consumers: EventConsumers,
        authorization: AcceptActivityAuthorization,
        config: AppConfig,
      ): ActivityAuthorizationHandler =>
        new ActivityAuthorizationHandler(
          consumers,
          authorization,
          config.IDENTITY_SERVICE_URL !== undefined,
        ),
    },
    {
      provide: SendActivityEmail,
      inject: [RECIPIENT_READER, DrizzleActivityDigestUnitOfWork, EMAIL_SENDER],
      useFactory: (
        recipients: ActivityRecipientReader,
        work: DrizzleActivityDigestUnitOfWork,
        sender: ActivityEmailSender,
      ): SendActivityEmail => new SendActivityEmail(recipients, work.delivery, sender, Date.now),
    },
    {
      provide: ActivityEmailJobsHandler,
      inject: [
        JobsService,
        PlanActivityEmail,
        SendActivityEmail,
        RequestActivityAuthorization,
        ListDueActivityOrganizations,
        CONFIG,
      ],
      useFactory: (
        jobs: JobsService,
        plan: PlanActivityEmail,
        send: SendActivityEmail,
        authorize: RequestActivityAuthorization,
        organizations: ListDueActivityOrganizations,
        config: AppConfig,
      ): ActivityEmailJobsHandler =>
        new ActivityEmailJobsHandler(
          jobs,
          plan,
          send,
          authorize,
          organizations,
          Date.now,
          { plan: PLAN_ACTIVITY_EMAIL_QUEUE, send: SEND_ACTIVITY_EMAIL_QUEUE },
          config.IDENTITY_SERVICE_URL !== undefined,
        ),
    },
  ],
  exports: [StageActivityEmail],
})
export class ActivityDigestsModule {}
