import { RESTRICTED_EVENT_NAMES } from '@cadenway/contracts/events/identity-service';
import { CONFIG, HealthModule, postgresIndicator } from '@cadenway/nest-common';
import type { PostgresProbe } from '@cadenway/nest-common';
import { DATABASE_POOL, DatabaseModule } from '@cadenway/nest-common/database';
import { JobsModule } from '@cadenway/nest-jobs';
import {
  MessagingConnection,
  MessagingModule,
  messagingHealthIndicator,
} from '@cadenway/nest-messaging';
import { OutboxModule } from '@cadenway/nest-messaging/outbox';
import { Module } from '@nestjs/common';

import type { AppConfig } from './config/app-config.js';
import { jobQueues } from './config/job-queues.js';
import { EmailModule } from './modules/email/email.module.js';
import { PlatformModule } from './modules/platform/platform.module.js';

/**
 * Class AppModule
 *
 * @description
 * Root module of the service. `createApplication` of `@cadenway/nest-common` wraps it with the
 * logs, the `application/problem+json` errors, the validation pipe, the internal token guard and
 * the other shared formats; this module declares what the service itself depends on. Importing it
 * reads no configuration: every module below is built when the application is created.
 *
 * - `CONFIG` is not provided here: `main.ts` validates the environment once against
 *   `appConfigSchema`, inside `runApplication`, and `createApplication` provides that result
 *   globally (`provideConfig: true`); a test provides its own with `ConfigModule.forValue`.
 *   Importing this module reads no configuration.
 * - `DatabaseModule`: the pool of this service's own database, opened as the application role of
 *   `DATABASE_URL`, the tenant and system transaction runners, and the `Idempotency-Key`
 *   interceptor for the routes marked `@Idempotent()`. The pool closes on shutdown.
 * - `MessagingModule`: the NATS connection of the `notification` user, with the inbox prefix
 *   `_INBOX.notification` the broker requires. The creation waits for the first connection, then
 *   checks that the `EVENTS`, `EVENTS_RESTRICTED` and `EVENTS_DLQ` streams exist: cadenway-ops
 *   creates them (`manageStreams: false`). This service runs the dead-letter worker of the platform
 *   (`deadLetterWorker: true`), because it alone may read `EVENTS_RESTRICTED`: it receives the
 *   delivery advisories of `EVENTS` and `EVENTS_RESTRICTED` in a queue group, reads the message a
 *   consumer gave up on by its sequence and copies it into `EVENTS_DLQ` on
 *   `dlq.<consumer>.<subject>`. The copy of a restricted event keeps its headers only
 *   (`restrictedDeadLetterPayload: 'drop'`, the default of the kit, stated here on purpose): its
 *   body may hold a single-use code or a reset token, which would otherwise stay 30 days in
 *   `EVENTS_DLQ`. `restrictedEvents` lists `RESTRICTED_EVENT_NAMES` of the identity-service events
 *   of `@cadenway/contracts` (`one-time-code.issued.v1`, `password-reset-link.issued.v1`): their
 *   consumers read `EVENTS_RESTRICTED` on `restricted.<name>`. The service publishes nothing yet: `@cadenway/contracts` defines no event
 *   of its own.
 * - `OutboxModule`: the outbox writer, the PostgreSQL deduplicator and the relay, which polls
 *   `outbox_events` every second in a system transaction and publishes the pending rows. It runs in
 *   every replica; `for update skip locked` keeps two of them from publishing the same row.
 * - `HealthModule`: `GET /health/live` answers as soon as the process runs; `GET /health/ready`
 *   answers 503 while PostgreSQL or NATS does not answer within 1 second, and from the start of a
 *   shutdown. Both routes are exempt from the internal token, every other route requires it.
 *   `shutdownDelayMs` is 0: nothing that routes to this internal service reads its readiness.
 *   Callers reach it through the Docker DNS of the `internal` network, which keeps returning a
 *   stopping container until it exits, whatever its health (checked on Docker 28.2), and the GitOps
 *   agent only waits for the new container to be healthy before it stops the old one. A delay would
 *   lengthen every stop, under the 10 second default grace period of Docker, without moving any
 *   request away; set it above the probe interval of a proxy if one ever routes on readiness.
 * - `JobsModule`: the durable jobs of `@cadenway/nest-jobs`, on pg-boss in the `pgboss` schema of
 *   this service's own database, as the application role of `DATABASE_URL`, with a pool of two
 *   connections of its own. `src/migrate.ts` provisions the schema and the queues of
 *   `src/config/job-queues.ts` as the migrator role; the start-up fails while they are missing.
 *   Running jobs get 30 seconds to finish at shutdown.
 * - `PlatformModule`: the owner of the kit tables in the migrations of the service.
 * - `EmailModule`: the e-mails that carry a single-use code, the invitation e-mail and the
 *   security e-mails of the account events (`src/modules/email/MODULE.md`).
 *
 * Business modules under `src/modules/` are registered here as they are created.
 */
@Module({
  imports: [
    DatabaseModule.forRootAsync({
      inject: [CONFIG],
      useFactory: (config: AppConfig) => ({
        connectionString: config.DATABASE_URL,
        applicationName: 'notification-service',
        idempotency: true,
        transactionMaxAttempts: config.DATABASE_TRANSACTION_MAX_ATTEMPTS,
      }),
    }),
    MessagingModule.forRootAsync({
      inject: [CONFIG],
      useFactory: (config: AppConfig) => ({
        service: 'notification-service',
        servers: config.NATS_URL,
        user: config.NATS_USER,
        password: config.NATS_PASSWORD,
        manageStreams: false,
        deadLetterWorker: true,
        restrictedDeadLetterPayload: 'drop',
        restrictedEvents: RESTRICTED_EVENT_NAMES,
      }),
    }),
    OutboxModule.forRoot(),
    JobsModule.forRootAsync({
      inject: [CONFIG],
      useFactory: (config: AppConfig) => ({
        connection: { connectionString: config.DATABASE_URL },
        queues: jobQueues,
      }),
    }),
    HealthModule.forRootAsync({
      inject: [DATABASE_POOL, MessagingConnection],
      useFactory: (pool: PostgresProbe, connection: MessagingConnection) => ({
        indicators: [postgresIndicator(pool), messagingHealthIndicator(connection)],
        shutdownDelayMs: 0,
      }),
    }),
    PlatformModule,
    EmailModule,
  ],
})
export class AppModule {}
