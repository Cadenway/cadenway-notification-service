import { CONFIG, InternalTokenSigner } from '@cadenway/nest-common';
import { TenantTransactionRunner, type TransactionScope } from '@cadenway/nest-common/database';
import { JobsService } from '@cadenway/nest-jobs';
import { EventConsumers } from '@cadenway/nest-messaging';
import type { FactoryProvider, OnApplicationBootstrap } from '@nestjs/common';

import type { AppConfig } from '../../../../../../config/app-config.js';
import { QUOTA_ALERT_QUEUE } from '../../../../../../config/job-queues.js';
import { createNotificationRecipientReader } from '../../../../../../infrastructure/http/notification-recipient-reader.js';
import { SendQuotaAlertEmail } from '../../../../../email/public/quota-alert/send-quota-alert-email.js';
import { ReadActivityPreferences } from '../../../../../notification-preferences/public/preferences/read-activity-preferences.js';
import { PlanQuotaAlertPage } from '../../../../application/use-cases/commands/alerts/plan-quota-alert-page/plan-quota-alert-page.use-case.js';
import { RequestQuotaAlert } from '../../../../application/use-cases/commands/alerts/request-quota-alert/request-quota-alert.use-case.js';
import { SendQuotaAlert } from '../../../../application/use-cases/commands/alerts/send-quota-alert/send-quota-alert.use-case.js';
import { createOrganizationQuotaRecipients } from '../../../../infrastructure/adapters/organization/alerts/organization-quota-recipients.adapter.js';
import { JobsQuotaAlertQueue } from '../../../../infrastructure/jobs/pg-boss/alerts/jobs-quota-alert-queue.adapter.js';
import { QuotaAlertJobsHandler } from '../../../../presentation/jobs/handlers/alerts/quota-alert-jobs.handler.js';
import { QuotaThresholdReachedHandler } from '../../../../presentation/messaging/handlers/billing/quota-threshold-reached.handler.js';

const QUOTA_ALERT_RUNTIME = Symbol('QUOTA_ALERT_RUNTIME');

/** Enables quota delivery when both sources of current authority are configured. */
export const quotaAlertRuntimeProvider: FactoryProvider<OnApplicationBootstrap | null> = {
  provide: QUOTA_ALERT_RUNTIME,
  inject: [
    CONFIG,
    TenantTransactionRunner,
    JobsService,
    EventConsumers,
    ReadActivityPreferences,
    SendQuotaAlertEmail,
  ],
  useFactory: async (
    config: AppConfig,
    tenant: TenantTransactionRunner,
    jobs: JobsService,
    consumers: EventConsumers,
    preferences: ReadActivityPreferences<TransactionScope>,
    email: SendQuotaAlertEmail,
  ): Promise<OnApplicationBootstrap | null> => {
    const {
      ORGANIZATION_SERVICE_URL: organizationUrl,
      IDENTITY_SERVICE_URL: identityUrl,
      INTERNAL_TOKEN_PRIVATE_JWK: privateJwk,
    } = config;
    if (organizationUrl === undefined || identityUrl === undefined || privateJwk === undefined) {
      return null;
    }

    const signer = await InternalTokenSigner.create({ issuer: 'notification-service', privateJwk });
    const recipients = createOrganizationQuotaRecipients({ baseUrl: organizationUrl, signer });
    const profiles = createNotificationRecipientReader({ baseUrl: identityUrl, signer });
    const queue = new JobsQuotaAlertQueue(tenant, jobs);
    const send = new SendQuotaAlert(recipients, {
      isEnabled: (userId) =>
        tenant.run(async (scope) => {
          const { channels } = await preferences.execute(scope, userId);
          return channels.billing.email;
        }),
      resolve: async (userId, signal) =>
        (await profiles.findCurrent(userId, signal))?.email ?? null,
      send: (occurrenceId, address, { metric, thresholdPercent, used, limit }) =>
        email.execute({ occurrenceId, address, metric, thresholdPercent, used, limit }),
    });
    const worker = new QuotaAlertJobsHandler(
      jobs,
      new PlanQuotaAlertPage(recipients, queue),
      send,
      QUOTA_ALERT_QUEUE,
    );
    const handler = new QuotaThresholdReachedHandler(consumers, new RequestQuotaAlert(queue));

    return {
      async onApplicationBootstrap() {
        await worker.onApplicationBootstrap();
        await handler.onApplicationBootstrap();
      },
    };
  },
};
