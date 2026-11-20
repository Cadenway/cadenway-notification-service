import { execFileSync } from 'node:child_process';
import { generateKeyPairSync, randomUUID } from 'node:crypto';
import { createServer } from 'node:net';
import { fileURLToPath } from 'node:url';

import { reminderDueV1Schema } from '@cadenway/contracts/events/notification-service';
import {
  taskAssignedV1Schema,
  taskNotificationDeliveryAuthorizedV1Schema,
} from '@cadenway/contracts/events/task-service';
import {
  GetTaskReminderInternalResponse,
  ListInboxNotificationsInternalResponse,
  SetTaskReminderInternalResponse,
  UpdateNotificationPreferencesInternalResponse,
} from '@cadenway/contracts/validators/internal/notification-service';
import {
  createApplication,
  InternalTokenSigner,
  loadConfig,
  runWithOrganizationContext,
} from '@cadenway/nest-common';
import type {
  Ed25519PrivateJwk,
  Ed25519PublicJwk,
  OrganizationContext,
} from '@cadenway/nest-common';
import {
  DATABASE_POOL,
  SystemTransactionRunner,
  TenantTransactionRunner,
} from '@cadenway/nest-common/database';
import type { DatabaseSchema, TransactionScope } from '@cadenway/nest-common/database';
import { Controller, Get, Injectable, Module } from '@nestjs/common';
import type { BeforeApplicationShutdown } from '@nestjs/common';
import type { NestExpressApplication } from '@nestjs/platform-express';
import pg from 'pg';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';

import { AppModule } from '../src/app.module.js';
import { appConfigSchema } from '../src/config/app-config.js';
import type { InboxAuthorizationAttempt } from '../src/modules/inbox/application/models/inbox/inbox-authorization-attempt.model.js';
import { InboxGenerationChanged } from '../src/modules/inbox/application/models/inbox/inbox-generation-changed.model.js';
import { AcceptInboxDeliveryAuthorization } from '../src/modules/inbox/application/use-cases/commands/inbox/accept-inbox-delivery-authorization/accept-inbox-delivery-authorization.use-case.js';
import { StageInboxDeliveries } from '../src/modules/inbox/application/use-cases/commands/inbox/stage-inbox-deliveries/stage-inbox-deliveries.use-case.js';
import { DrizzleInboxDeliveryUnitOfWork } from '../src/modules/inbox/infrastructure/persistence/drizzle/transactions/inbox/drizzle-inbox-delivery.unit-of-work.js';
import { InboxNotification } from '../src/modules/inbox/domain/aggregates/inbox/inbox-notification.aggregate.js';
import { DrizzleInboxRecords } from '../src/modules/inbox/infrastructure/persistence/drizzle/repositories/inbox/drizzle-inbox-records.repository.js';
import { DrizzleInboxRecordsUnitOfWork } from '../src/modules/inbox/infrastructure/persistence/drizzle/transactions/inbox/drizzle-inbox-records.unit-of-work.js';
import { UpdateNotificationPreferences } from '../src/modules/notification-preferences/application/use-cases/commands/preferences/update-notification-preferences/update-notification-preferences.use-case.js';
import { GetNotificationPreferences } from '../src/modules/notification-preferences/application/use-cases/queries/preferences/get-notification-preferences/get-notification-preferences.use-case.js';
import { SystemPreferencesUnitOfWork } from '../src/modules/notification-preferences/infrastructure/persistence/drizzle/transactions/preferences/system-preferences.unit-of-work.js';
import { Reminder } from '../src/modules/reminders/domain/aggregates/reminder/reminder.aggregate.js';
import { ReminderGenerationChanged } from '../src/modules/reminders/application/models/reminder/reminder-generation-changed.model.js';
import { DrizzleReminderRecords } from '../src/modules/reminders/infrastructure/persistence/drizzle/repositories/reminder/drizzle-reminder-records.repository.js';
import { DrizzleReminderCandidatesReader } from '../src/modules/reminders/infrastructure/persistence/drizzle/repositories/reminder/drizzle-reminder-candidates.repository.js';
import { DrizzleRemindersUnitOfWork } from '../src/modules/reminders/infrastructure/persistence/drizzle/transactions/reminder/drizzle-reminders.unit-of-work.js';
import { SetTaskReminder } from '../src/modules/reminders/application/use-cases/commands/reminder/set-task-reminder/set-task-reminder.use-case.js';
import { GetTaskReminder } from '../src/modules/reminders/application/use-cases/queries/reminder/get-task-reminder/get-task-reminder.use-case.js';

// The service as main.ts assembles it, on a disposable PostgreSQL and NATS.
// `@cadenway/nest-testing` does not export its container fixtures yet and a service never depends
// on `testcontainers` itself, so the dependencies are those of compose.dev.yaml, started as a
// throwaway Compose project on free ports: PostgreSQL with the two roles of cadenway-ops, NATS with
// its authorization (the `notification` user, its subjects, the inbox prefix `_INBOX.notification`)
// and its three streams.

/** Compose file of the development dependencies. */
const composeFile: string = fileURLToPath(new URL('../compose.dev.yaml', import.meta.url));

/** Throwaway project name: it never touches the data of the developer's own dev stack. */
const project = `cadenway-notification-service-test-${String(process.pid)}`;

/**
 * Host port of NATS. Fixed for the run, unlike the ephemeral port of PostgreSQL: the service must
 * find NATS at the same address after the test restarts it, and Docker gives an ephemeral mapping a
 * new port at each start.
 */
let natsHostPort = '0';

/** Atelier Nord, the organization of the mockup. */
const atelierNordId = '01938f6e-6d1a-7c3e-9a51-2f0c4b8d7e10';

/** Another organization, which must never see a row of Atelier Nord. */
const otherOrganizationId = '01938f6e-0000-7000-8000-000000000002';

/** Camille Martin (CM), the member of Atelier Nord the mockup signs in as. */
const camilleMartinId = '01938f6e-8a42-7d5b-b2c9-5e1f3a6d9c24';

/** The tables of the platform module, as the kit names them. */
const platformTables = [
  'event_versions',
  'idempotency_keys',
  'outbox_events',
  'processed_events',
] as const;

/** Every table owned by this service and the shared messaging platform. */
const serviceTables = [
  'code_email_deliveries',
  'event_versions',
  'idempotency_keys',
  'inbox_delivery_authorization_attempts',
  'inbox_generations',
  'inbox_notifications',
  'invitation_email_deliveries',
  'notification_preferences',
  'outbox_events',
  'pending_code_emails',
  'pending_invitation_emails',
  'pending_security_emails',
  'processed_events',
  'reminder_authorization_attempts',
  'reminder_generations',
  'reminders',
  'security_email_deliveries',
] as const;

/** The migrations of the service, all applied by the migrator. */
const migrationCount = 8;

/**
 * Runs `docker compose` on the throwaway project.
 *
 * @param args - Compose command and its arguments.
 * @returns The standard output.
 */
function compose(...args: readonly string[]): string {
  return execFileSync(
    'docker',
    ['compose', '--project-name', project, '--file', composeFile, ...args],
    {
      encoding: 'utf8',
      env: { ...process.env, DEV_POSTGRES_PORT: '0', DEV_NATS_PORT: natsHostPort },
      stdio: ['ignore', 'pipe', 'pipe'],
    },
  );
}

/**
 * Runs the NATS command line of the `nats-streams` container against the broker of the project.
 *
 * @param env - Variables that replace the `admin` credentials of the container for this call.
 * @param args - Arguments of the `nats` command.
 * @returns Whether the broker accepted the command.
 */
function brokerAccepts(env: Readonly<Record<string, string>>, ...args: readonly string[]): boolean {
  const variables = Object.entries(env).flatMap(([name, value]) => ['--env', `${name}=${value}`]);
  try {
    compose('exec', '-T', ...variables, 'nats-streams', 'nats', '--timeout', '2s', ...args);
    return true;
  } catch {
    return false;
  }
}

/**
 * Runs the NATS command line of the `nats-streams` container as `admin`, the user cadenway-ops gives
 * the stream script and the operators who read the dead letters.
 *
 * @param args - Arguments of the `nats` command.
 * @returns The standard output.
 */
function asAdmin(...args: readonly string[]): string {
  return compose('exec', '-T', 'nats-streams', 'nats', '--timeout', '2s', ...args);
}

/**
 * Makes a consumer of another backend give up on one message: a durable pull consumer with a single
 * delivery and a one-second acknowledgement wait receives the message and never acknowledges it, so
 * the server publishes the max-deliveries advisory the dead-letter worker listens to.
 *
 * @param stream - Stream of the message, `EVENTS` or `EVENTS_RESTRICTED`.
 * @param consumer - Durable consumer, named as the kit names them (`<service>__<handler>`).
 * @param subject - Subject the message is published on, the only one the consumer reads.
 * @param payload - Body of the message.
 */
function giveUpOn(stream: string, consumer: string, subject: string, payload: string): void {
  asAdmin(
    'consumer',
    'add',
    stream,
    consumer,
    '--pull',
    '--filter',
    subject,
    '--max-deliver',
    '1',
    '--ack',
    'explicit',
    '--wait',
    '1s',
    '--deliver',
    'all',
    '--replay',
    'instant',
    '--defaults',
  );
  asAdmin('pub', '--jetstream', subject, payload);
  asAdmin('consumer', 'next', stream, consumer, '--no-ack');
}

/**
 * Reads the last dead letter stored under a subject of `EVENTS_DLQ`, as an operator would.
 *
 * @param subject - Subject of the copy, `dlq.<consumer>.<original subject>`.
 * @returns Its headers and its body; the command fails while no such copy exists.
 */
function lastDeadLetter(subject: string): {
  readonly headers: Readonly<Record<string, string>>;
  readonly body: string;
} {
  const message = JSON.parse(
    asAdmin('stream', 'get', 'EVENTS_DLQ', '--last-for', subject, '--json'),
  ) as { readonly hdrs?: string; readonly data?: string };
  const headerLines = Buffer.from(message.hdrs ?? '', 'base64')
    .toString('utf8')
    .split('\r\n')
    .slice(1)
    .filter((line) => line.includes(':'));
  return {
    headers: Object.fromEntries(
      headerLines.map((line) => [
        line.slice(0, line.indexOf(':')),
        line.slice(line.indexOf(':') + 1).trim(),
      ]),
    ),
    body: Buffer.from(message.data ?? '', 'base64').toString('utf8'),
  };
}

/**
 * Finds a port of the loopback interface that nothing listens on.
 *
 * @returns A free port, released before it is returned.
 */
async function freePort(): Promise<string> {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      server.close(() => {
        if (address === null || typeof address === 'string') {
          reject(new Error('The probe server has no TCP address.'));
        } else {
          resolve(String(address.port));
        }
      });
    });
  });
}

/**
 * Reads the published host port of a service of the project.
 *
 * @param service - Compose service.
 * @param port - Port inside the container.
 * @returns The host port.
 */
function hostPort(service: string, port: string): string {
  return compose('port', service, port).trim().split(':').at(-1) ?? '';
}

/**
 * Creates an Ed25519 key pair in the JWK forms the internal token uses.
 *
 * @returns The public key for the verifier and the private key for a signer.
 */
function keyPair(): {
  readonly publicJwk: Ed25519PublicJwk;
  readonly privateJwk: Ed25519PrivateJwk;
} {
  const { x, d } = generateKeyPairSync('ed25519').privateKey.export({ format: 'jwk' });
  if (x === undefined || d === undefined) {
    throw new Error('Node returned an Ed25519 JWK without its key material.');
  }
  const publicJwk: Ed25519PublicJwk = { kty: 'OKP', crv: 'Ed25519', x, kid: 'test-api-gateway' };
  return { publicJwk, privateJwk: { ...publicJwk, d } };
}

/**
 * The organization context of a member of an organization, as the internal token gives it.
 *
 * @param organizationId - Organization of the context.
 * @returns The context the tenant runner reads.
 */
function memberOf(organizationId: string): OrganizationContext {
  return {
    organizationId,
    actor: { type: 'user', id: camilleMartinId },
    role: null,
    scopes: [],
  };
}

/** Stages a synthetic authorization envelope on the genuine transactional outbox table. */
async function writeInboxProbe(
  scope: TransactionScope,
  name: string,
  payload: Readonly<Record<string, unknown>>,
): Promise<void> {
  await scope.client.query(
    `insert into outbox_events
       (id, event_name, subject, stream, organization_id, payload, status, sent_at)
     values (uuidv7(), $1, 'evt.' || $1, 'EVENTS', $2, $3::jsonb, 'sent', now())`,
    [name, scope.organizationId, JSON.stringify(payload)],
  );
}

/** Records the locked probe correlation without registering an unpublished event. */
function writeInboxAuthorizationProbe(
  scope: TransactionScope,
  attempt: InboxAuthorizationAttempt,
): Promise<void> {
  return writeInboxProbe(scope, 'notification.inbox-authorization-test.v1', {
    authorizationRequestId: attempt.id,
    sourceEventId: attempt.candidate.sourceEventId,
  });
}

/** Reads a required string column from the raw transaction-client probe. */
function inboxProbeField(row: unknown, column: string): string {
  if (typeof row === 'object' && row !== null && column in row) {
    const value = (row as Record<string, unknown>)[column];
    if (typeof value === 'string') return value;
  }
  throw new Error(`Inbox authorization probe did not return ${column}.`);
}

/**
 * Applies the migrations with `src/migrate.ts`, the entry point of the migration container, as
 * the migrator role. Each call imports the module afresh, as each container start runs it once.
 */
async function runMigrator(): Promise<void> {
  vi.resetModules();
  const log = vi.spyOn(console, 'log').mockImplementation(() => undefined);
  try {
    await import('../src/migrate.js');
  } finally {
    log.mockRestore();
  }
}

/** Releases the shutdown held by `ShutdownGate`. */
let releaseShutdown: () => void = () => undefined;

/** Settles once `releaseShutdown` is called. */
const shutdownReleased = new Promise<void>((resolve) => {
  releaseShutdown = resolve;
});

/**
 * Holds the shutdown after readiness turned down and before the listener closes, the way a slow
 * handler or relay pass would, so the probes can be read during the stop.
 */
@Injectable()
class ShutdownGate implements BeforeApplicationShutdown {
  public async beforeApplicationShutdown(): Promise<void> {
    await shutdownReleased;
  }
}

/** A route of the application that declares no exemption, like every business route will. */
@Controller('internal/v1/wiring-probe')
class WiringProbeController {
  @Get()
  public probe(): { readonly reached: true } {
    return { reached: true };
  }
}

describe('notification-service wiring', () => {
  const gateway = keyPair();
  let app: NestExpressApplication | undefined;
  let signer: InternalTokenSigner;
  let migrator: pg.Pool;

  /**
   * The running application.
   *
   * @returns The application created in `beforeAll`.
   */
  function service(): NestExpressApplication {
    if (app === undefined) {
      throw new Error('The application did not start.');
    }
    return app;
  }

  beforeAll(async () => {
    natsHostPort = await freePort();
    compose(
      'up',
      '--detach',
      '--wait',
      '--wait-timeout',
      '120',
      'postgres',
      'nats',
      'nats-streams',
    );
    const postgresPort = hostPort('postgres', '5432');

    vi.stubEnv(
      'MIGRATION_DATABASE_URL',
      `postgres://notification_migrator:notification_migrator@127.0.0.1:${postgresPort}/notification`,
    );
    await runMigrator();
    migrator = new pg.Pool({
      connectionString: `postgres://notification_migrator:notification_migrator@127.0.0.1:${postgresPort}/notification`,
      max: 1,
      // Kept open for the whole run, so the stop of PostgreSQL below always reaches it.
      idleTimeoutMillis: 0,
    });
    // The client is terminated (57P01) when a test stops PostgreSQL; the pool reports it as an
    // `error` event, which would otherwise be an uncaught exception.
    migrator.on('error', () => undefined);

    vi.stubEnv('PORT', '3016');
    vi.stubEnv('LOG_PRETTY', 'false');
    vi.stubEnv(
      'DATABASE_URL',
      `postgres://notification_app:notification_app@127.0.0.1:${postgresPort}/notification`,
    );
    vi.stubEnv('NATS_URL', `nats://127.0.0.1:${natsHostPort}`);
    vi.stubEnv('NATS_USER', 'notification');
    vi.stubEnv('NATS_PASSWORD', 'notification');
    vi.stubEnv('INTERNAL_TOKEN_AUDIENCE', 'notification-service');
    vi.stubEnv(
      'INTERNAL_TOKEN_TRUSTED_ISSUERS',
      JSON.stringify({ 'api-gateway': [gateway.publicJwk] }),
    );
    // No e-mail is sent here: the SMTP server is never reached (tests/code-email.int-spec.ts sends).
    vi.stubEnv('SMTP_HOST', '127.0.0.1');
    vi.stubEnv('SMTP_PORT', '2525');
    vi.stubEnv('MAIL_FROM', 'no-reply@cadenway.localhost');
    @Module({
      imports: [AppModule],
      controllers: [WiringProbeController],
      providers: [ShutdownGate],
    })
    class ProbedApplicationModule {}

    // As main.ts: the configuration is read inside the start-up, never when a module is imported.
    const config = loadConfig(appConfigSchema);
    app = await createApplication(ProbedApplicationModule, {
      service: 'notification-service',
      config,
      provideConfig: true,
      internalToken: {
        verifier: {
          audience: config.INTERNAL_TOKEN_AUDIENCE,
          trustedIssuers: config.INTERNAL_TOKEN_TRUSTED_ISSUERS,
        },
      },
      logDestination: { write: (): void => undefined },
    });
    await app.init();
    signer = await InternalTokenSigner.create({
      issuer: 'api-gateway',
      privateJwk: gateway.privateJwk,
    });
  });

  afterAll(async () => {
    try {
      releaseShutdown();
      await app?.close();
      await migrator.end();
    } finally {
      vi.unstubAllEnvs();
      compose('down', '--volumes', '--remove-orphans');
    }
  });

  it('applies its migrations as the migrator role, which owns the tables', async () => {
    const tables = await migrator.query<{ tablename: string; tableowner: string }>(
      `select tablename, tableowner from pg_tables where schemaname = 'public' order by tablename`,
    );
    const journal = await migrator.query<{ applied: number }>(
      'select count(*)::int as applied from drizzle.__drizzle_migrations',
    );

    expect(tables.rows).toEqual(
      serviceTables.map((tablename) => ({ tablename, tableowner: 'notification_migrator' })),
    );
    expect(journal.rows).toEqual([{ applied: migrationCount }]);
  });

  it('applies nothing when the migrator runs again', async () => {
    await runMigrator();

    const journal = await migrator.query<{ applied: number }>(
      'select count(*)::int as applied from drizzle.__drizzle_migrations',
    );
    expect(journal.rows).toEqual([{ applied: migrationCount }]);
  });

  it('forces row-level security on the tables that carry an organization, a code or personal data', async () => {
    const tables = await migrator.query<{
      relname: string;
      relrowsecurity: boolean;
      relforcerowsecurity: boolean;
    }>(
      `select relname, relrowsecurity, relforcerowsecurity
         from pg_class
        where relnamespace = 'public'::regnamespace and relkind = 'r'
        order by relname`,
    );
    const policies = await migrator.query<{ tablename: string; policyname: string }>(
      `select tablename, policyname from pg_policies where schemaname = 'public' order by tablename`,
    );

    expect(tables.rows).toEqual([
      { relname: 'code_email_deliveries', relrowsecurity: true, relforcerowsecurity: true },
      { relname: 'event_versions', relrowsecurity: true, relforcerowsecurity: true },
      { relname: 'idempotency_keys', relrowsecurity: true, relforcerowsecurity: true },
      {
        relname: 'inbox_delivery_authorization_attempts',
        relrowsecurity: true,
        relforcerowsecurity: true,
      },
      { relname: 'inbox_generations', relrowsecurity: true, relforcerowsecurity: true },
      { relname: 'inbox_notifications', relrowsecurity: true, relforcerowsecurity: true },
      { relname: 'invitation_email_deliveries', relrowsecurity: true, relforcerowsecurity: true },
      { relname: 'notification_preferences', relrowsecurity: true, relforcerowsecurity: true },
      { relname: 'outbox_events', relrowsecurity: true, relforcerowsecurity: true },
      { relname: 'pending_code_emails', relrowsecurity: true, relforcerowsecurity: true },
      { relname: 'pending_invitation_emails', relrowsecurity: true, relforcerowsecurity: true },
      { relname: 'pending_security_emails', relrowsecurity: true, relforcerowsecurity: true },
      { relname: 'processed_events', relrowsecurity: false, relforcerowsecurity: false },
      {
        relname: 'reminder_authorization_attempts',
        relrowsecurity: true,
        relforcerowsecurity: true,
      },
      { relname: 'reminder_generations', relrowsecurity: true, relforcerowsecurity: true },
      { relname: 'reminders', relrowsecurity: true, relforcerowsecurity: true },
      { relname: 'security_email_deliveries', relrowsecurity: true, relforcerowsecurity: true },
    ]);
    expect(policies.rows).toEqual([
      {
        tablename: 'code_email_deliveries',
        policyname: 'code_email_deliveries_system_access',
      },
      { tablename: 'event_versions', policyname: 'event_versions_organization_isolation' },
      { tablename: 'idempotency_keys', policyname: 'idempotency_keys_organization_isolation' },
      {
        tablename: 'inbox_delivery_authorization_attempts',
        policyname: 'inbox_delivery_attempts_organization_isolation',
      },
      { tablename: 'inbox_generations', policyname: 'inbox_generations_organization_isolation' },
      {
        tablename: 'inbox_notifications',
        policyname: 'inbox_notifications_organization_isolation',
      },
      {
        tablename: 'invitation_email_deliveries',
        policyname: 'invitation_email_deliveries_organization_isolation',
      },
      {
        tablename: 'notification_preferences',
        policyname: 'notification_preferences_recipient_read',
      },
      {
        tablename: 'notification_preferences',
        policyname: 'notification_preferences_system_access',
      },
      { tablename: 'outbox_events', policyname: 'outbox_events_organization_isolation' },
      { tablename: 'pending_code_emails', policyname: 'pending_code_emails_system_access' },
      {
        tablename: 'pending_invitation_emails',
        policyname: 'pending_invitation_emails_organization_isolation',
      },
      { tablename: 'pending_security_emails', policyname: 'pending_security_emails_system_access' },
      {
        tablename: 'reminder_authorization_attempts',
        policyname: 'reminder_authorization_attempts_organization_isolation',
      },
      {
        tablename: 'reminder_generations',
        policyname: 'reminder_generations_organization_isolation',
      },
      { tablename: 'reminders', policyname: 'reminders_organization_isolation' },
      {
        tablename: 'security_email_deliveries',
        policyname: 'security_email_deliveries_system_access',
      },
    ]);
  });

  it('answers the liveness probe without a token', async () => {
    const response = await request(service().getHttpServer()).get('/health/live');

    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({ status: 'ok' });
  });

  it('is ready once PostgreSQL answers the application role and NATS the notification user', async () => {
    const response = await request(service().getHttpServer()).get('/health/ready');

    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({
      status: 'ok',
      details: { postgres: { status: 'up' }, nats: { status: 'up' } },
    });
  });

  it('refuses a route of the application without an internal token', async () => {
    const response = await request(service().getHttpServer()).get('/internal/v1/wiring-probe');

    expect(response.status).toBe(401);
    expect(response.headers['content-type']).toMatch(/^application\/problem\+json/u);
    expect(response.body).toMatchObject({ status: 401, code: 'auth.token-missing' });
  });

  it('serves a route to a trusted issuer acting for a member of the organization', async () => {
    const token = await signer.sign('notification-service', {
      actor: { type: 'user', id: camilleMartinId },
      organizationId: atelierNordId,
    });

    const response = await request(service().getHttpServer())
      .get('/internal/v1/wiring-probe')
      .set('Authorization', `Bearer ${token}`);

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ reached: true });
  });

  it('refuses a token signed for another service', async () => {
    const token = await signer.sign('document-service', {
      actor: { type: 'user', id: camilleMartinId },
      organizationId: atelierNordId,
    });

    const response = await request(service().getHttpServer())
      .get('/internal/v1/wiring-probe')
      .set('Authorization', `Bearer ${token}`);

    expect(response.status).toBe(401);
    expect(response.body).toMatchObject({
      code: 'auth.token-invalid',
      details: { reason: 'audience' },
    });
  });

  it('fires a scheduled reminder once after a timely Task permit', async () => {
    const testOrganizationId = randomUUID();
    const tenant = service().get(TenantTransactionRunner);
    const inTenant = <T>(
      work: (scope: TransactionScope<DatabaseSchema>) => Promise<T>,
    ): Promise<T> =>
      runWithOrganizationContext(memberOf(testOrganizationId), () => tenant.run(work));
    const taskId = randomUUID();
    const canceledTaskId = randomUUID();
    const note = 'Préparer la revue du sprint 14';
    const remindAt = new Date(Date.now() + 8_000).toISOString();
    const token = await signer.sign('notification-service', {
      actor: { type: 'user', id: camilleMartinId },
      organizationId: testOrganizationId,
    });
    const scheduled = await request(service().getHttpServer())
      .put(`/internal/v1/tasks/${taskId}/reminder`)
      .set('Authorization', `Bearer ${token}`)
      .send({ remindAt, note });
    expect(scheduled.status).toBe(201);
    const reminder = SetTaskReminderInternalResponse.parse(scheduled.body);
    expect(reminder).toMatchObject({ taskId, remindAt, note, firedAt: null, version: 1 });

    const canceled = await request(service().getHttpServer())
      .put(`/internal/v1/tasks/${canceledTaskId}/reminder`)
      .set('Authorization', `Bearer ${token}`)
      .send({ remindAt, note });
    expect(canceled.status).toBe(201);
    const canceledReminder = SetTaskReminderInternalResponse.parse(canceled.body);
    const removed = await request(service().getHttpServer())
      .delete(`/internal/v1/reminders/${canceledReminder.id}`)
      .query({ authorizedTaskId: canceledTaskId })
      .set('Authorization', `Bearer ${token}`);
    expect(removed.status).toBe(204);

    expect(Date.now()).toBeLessThan(Date.parse(remindAt));
    const beforeDue = await inTenant((scope) =>
      scope.client.query(
        `select count(*)::int as count from outbox_events
         where event_name = 'reminder.due.v1' and payload->>'reminderId' = $1`,
        [reminder.id],
      ),
    );
    expect(beforeDue.rows).toEqual([{ count: 0 }]);

    let attempt: { id: string; expires_at: Date } | undefined;
    await vi.waitFor(
      async () => {
        const result = await inTenant((scope) =>
          scope.client.query(
            `select attempt.id, attempt.expires_at
             from reminder_authorization_attempts attempt
             join outbox_events outbox on outbox.organization_id = attempt.organization_id
               and outbox.payload->>'authorizationRequestId' = attempt.id::text
             where attempt.reminder_id = $1
               and outbox.event_name = 'notification.delivery-authorization-requested.v1'
               and outbox.status = 'sent'`,
            [reminder.id],
          ),
        );
        expect(result.rows).toHaveLength(1);
        attempt = z.object({ id: z.uuid(), expires_at: z.date() }).parse(result.rows[0]);
      },
      { timeout: 35_000, interval: 200 },
    );
    if (attempt === undefined) throw new Error('The scheduled authorization was not recorded.');
    const decision = taskNotificationDeliveryAuthorizedV1Schema.parse({
      id: randomUUID(),
      occurredAt: new Date().toISOString(),
      organizationId: testOrganizationId,
      actor: { type: 'system', id: 'task-service' },
      version: 1,
      authorizationRequestId: attempt.id,
      decision: 'permit',
      validUntil: attempt.expires_at.toISOString(),
    });
    asAdmin(
      'pub',
      '--jetstream',
      'evt.task.notification-delivery-authorized.v1',
      JSON.stringify(decision),
    );

    await vi.waitFor(
      async () => {
        const result = await inTenant((scope) =>
          scope.client.query(
            `select payload, status from outbox_events
             where event_name = 'reminder.due.v1' and payload->>'reminderId' = $1`,
            [reminder.id],
          ),
        );
        expect(result.rows).toHaveLength(1);
        const row = z.object({ payload: z.unknown(), status: z.string() }).parse(result.rows[0]);
        expect(row.status).toBe('sent');
        const fact = reminderDueV1Schema.parse(row.payload);
        expect(fact).toMatchObject({
          organizationId: testOrganizationId,
          reminderId: reminder.id,
          userId: camilleMartinId,
          taskId,
          version: 2,
        });
        expect(Object.keys(fact).sort()).toEqual(
          [
            'actor',
            'id',
            'occurredAt',
            'organizationId',
            'reminderId',
            'taskId',
            'userId',
            'version',
          ].sort(),
        );
        expect(Date.parse(fact.occurredAt)).toBeGreaterThanOrEqual(Date.parse(remindAt));
      },
      { timeout: 15_000, interval: 200 },
    );

    const replay = { ...decision, id: randomUUID(), occurredAt: new Date().toISOString() };
    asAdmin(
      'pub',
      '--jetstream',
      'evt.task.notification-delivery-authorized.v1',
      JSON.stringify(replay),
    );
    await vi.waitFor(
      async () => {
        const processed = await migrator.query<{ count: number }>(
          `select count(*)::int as count from processed_events
           where consumer = 'notification-service__reminder-task-delivery-authorized' and event_id = $1`,
          [replay.id],
        );
        expect(processed.rows).toEqual([{ count: 1 }]);
      },
      { timeout: 10_000, interval: 200 },
    );
    const facts = await inTenant((scope) =>
      scope.client.query(
        `select payload->>'reminderId' as reminder_id from outbox_events
         where event_name = 'reminder.due.v1' and payload->>'reminderId' = any($1::text[])`,
        [[reminder.id, canceledReminder.id]],
      ),
    );
    expect(facts.rows).toEqual([{ reminder_id: reminder.id }]);
    const read = await request(service().getHttpServer())
      .get(`/internal/v1/tasks/${taskId}/reminder`)
      .set('Authorization', `Bearer ${token}`);
    expect(read.status).toBe(200);
    const fired = GetTaskReminderInternalResponse.parse(read.body);
    expect(fired).toMatchObject({
      id: reminder.id,
      version: 2,
    });
    expect(fired.firedAt).not.toBeNull();
  }, 65_000);

  it('creates one inbox notification after a Task assignment and current access permit', async () => {
    const testOrganizationId = randomUUID();
    const tenant = service().get(TenantTransactionRunner);
    const inTenant = <T>(
      work: (scope: TransactionScope<DatabaseSchema>) => Promise<T>,
    ): Promise<T> =>
      runWithOrganizationContext(memberOf(testOrganizationId), () => tenant.run(work));
    const source = taskAssignedV1Schema.parse({
      id: randomUUID(),
      occurredAt: new Date().toISOString(),
      organizationId: testOrganizationId,
      actor: { type: 'user', id: randomUUID() },
      version: 1,
      key: 'CAD-482',
      spaceId: randomUUID(),
      listId: randomUUID(),
      parentKey: null,
      name: 'Préparer le sprint 14',
      status: 'todo',
      cancelReason: null,
      priority: 'moyenne',
      assigneeId: camilleMartinId,
      assigneeIds: [camilleMartinId],
      dueDate: null,
      startDate: null,
      estimateMinutes: null,
      labels: [],
      completedAt: null,
    });
    asAdmin('pub', '--jetstream', 'evt.task.assigned.v1', JSON.stringify(source));

    let attempt: { id: string; expires_at: Date } | undefined;
    await vi.waitFor(
      async () => {
        const result = await inTenant((scope) =>
          scope.client.query(
            `select attempt.id, attempt.expires_at
             from inbox_delivery_authorization_attempts attempt
             join outbox_events outbox on outbox.organization_id = attempt.organization_id
               and outbox.payload->>'authorizationRequestId' = attempt.id::text
             where attempt.source_event_id = $1
               and outbox.event_name = 'notification.delivery-authorization-requested.v1'
               and outbox.status = 'sent'`,
            [source.id],
          ),
        );
        expect(result.rows).toHaveLength(1);
        attempt = z.object({ id: z.uuid(), expires_at: z.date() }).parse(result.rows[0]);
      },
      { timeout: 15_000, interval: 200 },
    );
    if (attempt === undefined) throw new Error('The inbox authorization was not recorded.');
    const decision = taskNotificationDeliveryAuthorizedV1Schema.parse({
      id: randomUUID(),
      occurredAt: new Date().toISOString(),
      organizationId: testOrganizationId,
      actor: { type: 'system', id: 'task-service' },
      version: 1,
      authorizationRequestId: attempt.id,
      decision: 'permit',
      validUntil: attempt.expires_at.toISOString(),
    });
    asAdmin(
      'pub',
      '--jetstream',
      'evt.task.notification-delivery-authorized.v1',
      JSON.stringify(decision),
    );

    let notificationId: string | undefined;
    await vi.waitFor(
      async () => {
        const result = await inTenant((scope) =>
          scope.client.query(
            `select notification.id, outbox.status
             from inbox_notifications notification
             join outbox_events outbox on outbox.organization_id = notification.organization_id
               and outbox.payload->>'notificationId' = notification.id::text
             where notification.source_event_id = $1
               and outbox.event_name = 'notification.created.v1'`,
            [source.id],
          ),
        );
        expect(result.rows).toHaveLength(1);
        const row = z.object({ id: z.uuid(), status: z.string() }).parse(result.rows[0]);
        expect(row.status).toBe('sent');
        notificationId = inboxProbeField(result.rows[0], 'id');
      },
      { timeout: 15_000, interval: 200 },
    );
    if (notificationId === undefined) throw new Error('The inbox notification was not created.');
    const token = await signer.sign('notification-service', {
      actor: { type: 'user', id: camilleMartinId },
      organizationId: testOrganizationId,
    });
    const response = await request(service().getHttpServer())
      .get('/internal/v1/inbox/notifications')
      .set('Authorization', `Bearer ${token}`);
    expect(response.status).toBe(200);
    const page = ListInboxNotificationsInternalResponse.parse(response.body);
    expect(page.items.find((item) => item.record.id === notificationId)?.record).toMatchObject({
      kind: 'assignment',
      subject: { kind: 'task-key', taskKey: 'CAD-482' },
      readAt: null,
    });
  }, 40_000);

  it('retries an unanswered inbox authorization with a new correlation and accepts only that permit', async () => {
    const organizationId = randomUUID();
    const recipientId = randomUUID();
    const tenant = service().get(TenantTransactionRunner);
    const inTenant = <T>(
      work: (scope: TransactionScope<DatabaseSchema>) => Promise<T>,
    ): Promise<T> => runWithOrganizationContext(memberOf(organizationId), () => tenant.run(work));
    const source = taskAssignedV1Schema.parse({
      id: randomUUID(),
      occurredAt: new Date().toISOString(),
      organizationId,
      actor: { type: 'user', id: randomUUID() },
      version: 1,
      key: 'CAD-482',
      spaceId: randomUUID(),
      listId: randomUUID(),
      parentKey: null,
      name: 'Préparer le sprint 14',
      status: 'todo',
      cancelReason: null,
      priority: 'moyenne',
      assigneeId: recipientId,
      assigneeIds: [recipientId],
      dueDate: null,
      startDate: null,
      estimateMinutes: null,
      labels: [],
      completedAt: null,
    });
    asAdmin('pub', '--jetstream', 'evt.task.assigned.v1', JSON.stringify(source));

    let first: { id: string; expires_at: Date } | undefined;
    await vi.waitFor(
      async () => {
        const result = await inTenant((scope) =>
          scope.client.query(
            `select attempt.id, attempt.expires_at
             from inbox_delivery_authorization_attempts attempt
             join outbox_events outbox on outbox.organization_id = attempt.organization_id
               and outbox.payload->>'authorizationRequestId' = attempt.id::text
             where attempt.source_event_id = $1 and attempt.recipient_id = $2
               and outbox.event_name = 'notification.delivery-authorization-requested.v1'
               and outbox.status = 'sent'`,
            [source.id, recipientId],
          ),
        );
        expect(result.rows).toHaveLength(1);
        first = z.object({ id: z.uuid(), expires_at: z.date() }).parse(result.rows[0]);
      },
      { timeout: 15_000, interval: 200 },
    );
    if (first === undefined) throw new Error('The first authorization was not recorded.');
    const firstAttempt = first;

    let replacement: { id: string; expires_at: Date } | undefined;
    await vi.waitFor(
      async () => {
        const result = await inTenant((scope) =>
          scope.client.query(
            `select attempt.id, attempt.expires_at
             from inbox_delivery_authorization_attempts attempt
             join outbox_events outbox on outbox.organization_id = attempt.organization_id
               and outbox.payload->>'authorizationRequestId' = attempt.id::text
             where attempt.source_event_id = $1 and attempt.recipient_id = $2
               and attempt.id <> $3 and attempt.outcome = 'pending'
               and outbox.event_name = 'notification.delivery-authorization-requested.v1'
               and outbox.status = 'sent'`,
            [source.id, recipientId, firstAttempt.id],
          ),
        );
        expect(result.rows).toHaveLength(1);
        replacement = z.object({ id: z.uuid(), expires_at: z.date() }).parse(result.rows[0]);
      },
      { timeout: 55_000, interval: 250 },
    );
    if (replacement === undefined)
      throw new Error('The replacement authorization was not recorded.');
    const secondAttempt = replacement;
    expect(Date.now()).toBeGreaterThanOrEqual(firstAttempt.expires_at.getTime());
    expect(secondAttempt.id).not.toBe(firstAttempt.id);
    const oldPermit = taskNotificationDeliveryAuthorizedV1Schema.parse({
      id: randomUUID(),
      occurredAt: new Date(firstAttempt.expires_at.getTime() - 1_000).toISOString(),
      organizationId,
      actor: { type: 'system', id: 'task-service' },
      version: 1,
      authorizationRequestId: firstAttempt.id,
      decision: 'permit',
      validUntil: firstAttempt.expires_at.toISOString(),
    });
    asAdmin(
      'pub',
      '--jetstream',
      'evt.task.notification-delivery-authorized.v1',
      JSON.stringify(oldPermit),
    );
    await vi.waitFor(
      async () => {
        const processed = await migrator.query<{ count: number }>(
          `select count(*)::int as count from processed_events
           where consumer = 'notification-service__inbox-task-delivery-authorized' and event_id = $1`,
          [oldPermit.id],
        );
        expect(processed.rows).toEqual([{ count: 1 }]);
      },
      { timeout: 10_000, interval: 200 },
    );
    await inTenant(async (scope) => {
      const attempt = await scope.client.query(
        'select id, outcome from inbox_delivery_authorization_attempts where source_event_id = $1',
        [source.id],
      );
      const inbox = await scope.client.query(
        'select id from inbox_notifications where source_event_id = $1',
        [source.id],
      );
      expect(attempt.rows).toEqual([{ id: secondAttempt.id, outcome: 'pending' }]);
      expect(inbox.rows).toEqual([]);
    });

    const newPermit = taskNotificationDeliveryAuthorizedV1Schema.parse({
      ...oldPermit,
      id: randomUUID(),
      occurredAt: new Date().toISOString(),
      authorizationRequestId: secondAttempt.id,
      validUntil: secondAttempt.expires_at.toISOString(),
    });
    asAdmin(
      'pub',
      '--jetstream',
      'evt.task.notification-delivery-authorized.v1',
      JSON.stringify(newPermit),
    );
    await vi.waitFor(
      async () => {
        await inTenant(async (scope) => {
          const inbox = await scope.client.query(
            `select id from inbox_notifications where source_event_id = $1 and recipient_id = $2`,
            [source.id, recipientId],
          );
          expect(inbox.rows).toHaveLength(1);
          const id = inboxProbeField(inbox.rows[0], 'id');
          const facts = await scope.client.query(
            `select status from outbox_events where event_name = 'notification.created.v1'
             and payload->>'notificationId' = $1`,
            [id],
          );
          expect(facts.rows).toEqual([{ status: 'sent' }]);
          const attempts = await scope.client.query(
            `select id, outcome from inbox_delivery_authorization_attempts where source_event_id = $1`,
            [source.id],
          );
          expect(attempts.rows).toEqual([{ id: secondAttempt.id, outcome: 'permitted' }]);
          const requests = await scope.client.query(
            `select payload->>'authorizationRequestId' as id from outbox_events
             where event_name = 'notification.delivery-authorization-requested.v1'
               and payload->>'recipientId' = $1 order by created_at`,
            [recipientId],
          );
          expect(requests.rows).toEqual([{ id: firstAttempt.id }, { id: secondAttempt.id }]);
        });
      },
      { timeout: 15_000, interval: 200 },
    );
  }, 105_000);

  it('suppresses an assigned-task inbox item when in-app delivery is disabled', async () => {
    const testOrganizationId = randomUUID();
    const tenant = service().get(TenantTransactionRunner);
    const recipientId = randomUUID();
    const token = await signer.sign('notification-service', {
      actor: { type: 'user', id: recipientId },
      organizationId: testOrganizationId,
    });
    const updated = await request(service().getHttpServer())
      .patch('/internal/v1/me/notification-preferences')
      .set('Authorization', `Bearer ${token}`)
      .send({ channels: { assignment: { inApp: false, email: true } } });
    expect(updated.status).toBe(200);
    const preferences = UpdateNotificationPreferencesInternalResponse.parse(updated.body);
    expect(preferences.channels.assignment).toMatchObject({ inApp: false, email: true });

    const source = taskAssignedV1Schema.parse({
      id: randomUUID(),
      occurredAt: new Date().toISOString(),
      organizationId: testOrganizationId,
      actor: { type: 'user', id: randomUUID() },
      version: 1,
      key: 'CAD-482',
      spaceId: randomUUID(),
      listId: randomUUID(),
      parentKey: null,
      name: 'Préparer le sprint 14',
      status: 'todo',
      cancelReason: null,
      priority: 'moyenne',
      assigneeId: recipientId,
      assigneeIds: [recipientId],
      dueDate: null,
      startDate: null,
      estimateMinutes: null,
      labels: [],
      completedAt: null,
    });
    asAdmin('pub', '--jetstream', 'evt.task.assigned.v1', JSON.stringify(source));
    let attempt: { id: string; expires_at: Date } | undefined;
    await vi.waitFor(
      async () => {
        const result = await runWithOrganizationContext(memberOf(testOrganizationId), () =>
          tenant.run((scope) =>
            scope.client.query(
              `select attempt.id, attempt.expires_at
               from inbox_delivery_authorization_attempts attempt
               join outbox_events outbox on outbox.organization_id = attempt.organization_id
                 and outbox.payload->>'authorizationRequestId' = attempt.id::text
               where attempt.source_event_id = $1
                 and outbox.event_name = 'notification.delivery-authorization-requested.v1'
                 and outbox.status = 'sent'`,
              [source.id],
            ),
          ),
        );
        expect(result.rows).toHaveLength(1);
        attempt = z.object({ id: z.uuid(), expires_at: z.date() }).parse(result.rows[0]);
      },
      { timeout: 15_000, interval: 200 },
    );
    if (attempt === undefined) throw new Error('The inbox authorization was not recorded.');
    const decision = taskNotificationDeliveryAuthorizedV1Schema.parse({
      id: randomUUID(),
      occurredAt: new Date().toISOString(),
      organizationId: testOrganizationId,
      actor: { type: 'system', id: 'task-service' },
      version: 1,
      authorizationRequestId: attempt.id,
      decision: 'permit',
      validUntil: attempt.expires_at.toISOString(),
    });
    asAdmin(
      'pub',
      '--jetstream',
      'evt.task.notification-delivery-authorized.v1',
      JSON.stringify(decision),
    );
    await vi.waitFor(
      async () => {
        const result = await runWithOrganizationContext(memberOf(testOrganizationId), () =>
          tenant.run((scope) =>
            scope.client.query(
              'select outcome from inbox_delivery_authorization_attempts where source_event_id = $1',
              [source.id],
            ),
          ),
        );
        expect(result.rows).toEqual([{ outcome: 'permitted' }]);
      },
      { timeout: 15_000, interval: 200 },
    );
    await runWithOrganizationContext(memberOf(testOrganizationId), () =>
      tenant.run(async (scope) => {
        const inbox = await scope.client.query(
          'select id from inbox_notifications where source_event_id = $1',
          [source.id],
        );
        const facts = await scope.client.query(
          `select id from outbox_events where event_name = 'notification.created.v1'
           and payload->>'recipientId' = $1`,
          [recipientId],
        );
        expect(inbox.rows).toEqual([]);
        expect(facts.rows).toEqual([]);
      }),
    );
    const listed = await request(service().getHttpServer())
      .get('/internal/v1/inbox/notifications')
      .set('Authorization', `Bearer ${token}`);
    expect(listed.status).toBe(200);
    expect(ListInboxNotificationsInternalResponse.parse(listed.body).items).toEqual([]);
  }, 40_000);

  it('lets the application role read and write the platform tables of its organization only', async () => {
    const tenant = service().get(TenantTransactionRunner);
    const countAll = async (organizationId: string): Promise<Record<string, number>> =>
      runWithOrganizationContext(memberOf(organizationId), () =>
        tenant.run(async (tx) => {
          const counts = await tx.client.query(
            `select 'outbox_events' as name, count(*)::int as rows from outbox_events
             union all select 'event_versions', count(*)::int from event_versions
             union all select 'idempotency_keys', count(*)::int from idempotency_keys`,
          );
          const rows = counts.rows as readonly { readonly name: string; readonly rows: number }[];
          return Object.fromEntries(rows.map(({ name, rows: count }) => [name, count]));
        }),
      );

    // Sent rather than pending: the relay must have nothing to publish.
    await runWithOrganizationContext(memberOf(atelierNordId), () =>
      tenant.run(async (tx) => {
        await tx.client.query(
          `insert into outbox_events
             (id, event_name, subject, stream, organization_id, payload, status, sent_at)
           values (uuidv7(), 'notification.wiring-probe.v1', 'evt.notification.wiring-probe.v1',
                   'EVENTS', $1, '{}', 'sent', now())`,
          [atelierNordId],
        );
        await tx.client.query(
          `insert into event_versions (consumer, organization_id, aggregate_key, version)
           values ('notification-service__wiring-probe', $1, 'notification:wiring-probe', 1)`,
          [atelierNordId],
        );
        await tx.client.query(
          `update event_versions set version = 2 where aggregate_key = 'notification:wiring-probe'`,
        );
        await tx.client.query(
          `insert into idempotency_keys
             (organization_id, key, request_fingerprint, response_status, response_headers,
              expires_at)
           values ($1, 'wiring-probe', 'fingerprint', 201, '{}', now() + interval '1 day')`,
          [atelierNordId],
        );
        await tx.client.query(
          `insert into processed_events (consumer, event_id)
           values ('notification-service__wiring-probe', uuidv7())`,
        );
      }),
    );

    expect(await countAll(atelierNordId)).toEqual({
      outbox_events: 1,
      event_versions: 1,
      idempotency_keys: 1,
    });
    expect(await countAll(otherOrganizationId)).toEqual({
      outbox_events: 0,
      event_versions: 0,
      idempotency_keys: 0,
    });
    await expect(
      runWithOrganizationContext(memberOf(otherOrganizationId), () =>
        tenant.run((tx) =>
          tx.client.query(
            `insert into event_versions (consumer, organization_id, aggregate_key, version)
             values ('notification-service__wiring-probe', $1, 'notification:wiring-probe-2', 1)`,
            [atelierNordId],
          ),
        ),
      ),
    ).rejects.toMatchObject({ code: '42501' });

    const deleted = await runWithOrganizationContext(memberOf(atelierNordId), () =>
      tenant.run(async (tx) => {
        const counts: number[] = [];
        for (const table of platformTables) {
          const where =
            table === 'processed_events'
              ? " where consumer = 'notification-service__wiring-probe'"
              : '';
          counts.push(
            (await tx.client.query(`delete from ${table}${where} returning 1`)).rows.length,
          );
        }
        return counts;
      }),
    );
    expect(deleted).toEqual([1, 1, 1, 1]);
  });

  it('runs reminder CRUD and cursor lookahead in tenant transactions', async () => {
    const tenant = service().get<TenantTransactionRunner>(TenantTransactionRunner);
    const userId = '019a7000-1a2b-7c3d-8e4f-5a6b7c8d9061';
    const taskId = '019a7000-1a2b-7c3d-8e4f-5a6b7c8d9062';
    const nextTaskId = '019a7000-1a2b-7c3d-8e4f-5a6b7c8d9063';
    const now = Date.parse('2026-11-08T09:00:00.000Z');
    const scheduled: string[] = [];
    const work = new DrizzleRemindersUnitOfWork(tenant, (scope, reminder) => {
      expect(scope.organizationId).toBe(atelierNordId);
      scheduled.push(reminder.snapshot.id);
      return Promise.resolve();
    });
    const set = new SetTaskReminder(work);
    const get = new GetTaskReminder(work);
    const reader = new DrizzleReminderCandidatesReader(tenant);
    const inTenant = <T>(operation: () => Promise<T>): Promise<T> =>
      runWithOrganizationContext(memberOf(atelierNordId), operation);
    const input = {
      organizationId: atelierNordId,
      userId,
      taskId,
      remindAt: now + 60_000,
      note: null,
      now,
    };
    const first = await inTenant(() => set.execute(input));
    expect(first.created).toBe(true);
    expect(scheduled).toEqual([first.reminder.id]);
    expect(
      await inTenant(() => get.execute({ organizationId: atelierNordId, userId, taskId })),
    ).toMatchObject({
      id: first.reminder.id,
      taskId,
      version: 1,
    });
    expect((await inTenant(() => set.execute(input))).created).toBe(false);
    expect(scheduled).toHaveLength(1);
    await inTenant(() => set.execute({ ...input, taskId: nextTaskId, remindAt: now + 120_000 }));
    const page = await inTenant(() =>
      reader.page({
        organizationId: atelierNordId,
        userId,
        expectedGeneration: null,
        after: null,
        limit: 1,
      }),
    );
    expect(page.generation).toBe('2');
    expect(page.hasMore).toBe(true);
    expect(page.items.map((item) => item.snapshot.id)).toEqual([first.reminder.id]);
    const selection = await inTenant(() =>
      reader.selected({
        organizationId: atelierNordId,
        userId,
        expectedGeneration: page.generation,
        pairs: [{ id: first.reminder.id, taskId }],
      }),
    );
    expect(selection).toHaveLength(1);
    const failed = new SetTaskReminder(
      new DrizzleRemindersUnitOfWork(tenant, () =>
        Promise.reject(new Error('scheduler rejected the transaction')),
      ),
    );
    await expect(
      inTenant(() => failed.execute({ ...input, remindAt: now + 180_000 })),
    ).rejects.toThrow('scheduler rejected the transaction');
    const unchanged = await inTenant(() =>
      reader.page({
        organizationId: atelierNordId,
        userId,
        expectedGeneration: '2',
        after: null,
        limit: 1,
      }),
    );
    expect(unchanged.items[0]?.snapshot.remindAt).toBe(now + 60_000);
  });

  it('pins reminder candidates and checked records to a read-only owner snapshot', async () => {
    const tenant = service().get<TenantTransactionRunner>(TenantTransactionRunner);
    const user = '019a7000-1a2b-7c3d-8e4f-5a6b7c8d9071';
    const id = '019a7000-1a2b-7c3d-8e4f-5a6b7c8d9072';
    const taskId = '019a7000-1a2b-7c3d-8e4f-5a6b7c8d9073';
    const now = Date.parse('2026-11-08T09:00:00.000Z');
    const initial = Reminder.schedule(
      {
        id,
        organizationId: atelierNordId,
        userId: user,
        taskId,
        remindAt: now + 60_000,
        note: null,
      },
      now,
    );
    const inTenant = <T>(
      execute: (scope: TransactionScope) => Promise<T>,
      readOnly = false,
    ): Promise<T> =>
      runWithOrganizationContext(memberOf(atelierNordId), () =>
        tenant.run(execute, readOnly ? { readOnly: true, isolationLevel: 'repeatable read' } : {}),
      );
    const records = (scope: TransactionScope): DrizzleReminderRecords =>
      new DrizzleReminderRecords(scope, atelierNordId);

    await inTenant(async (scope) => {
      expect(await records(scope).pageAtGeneration(user, null, 10, null)).toEqual({
        generation: '0',
        items: [],
      });
      expect(await records(scope).selectedAtGeneration(user, '0', [])).toEqual([]);
    }, true);
    await inTenant(async (scope) => {
      await records(scope).lockTaskSlot(user, taskId);
      await records(scope).insert(initial);
    });
    const first = await inTenant(
      (scope) => records(scope).pageAtGeneration(user, null, 10, null),
      true,
    );
    expect(first.generation).toBe('1');
    expect(first.items.map((item) => item.snapshot.id)).toEqual([id]);

    const changed = initial.setSchedule(now + 120_000, 'Later', now);
    let markSnapshotReady: () => void = () => undefined;
    const snapshotReady = new Promise<void>((resolve) => {
      markSnapshotReady = resolve;
    });
    let finishSnapshot: () => void = () => undefined;
    const continueSnapshot = new Promise<void>((resolve) => {
      finishSnapshot = resolve;
    });
    const concurrentRead = inTenant(async (scope) => {
      const store = records(scope);
      expect(
        (await store.pageAtGeneration(user, '1', 10, null)).items[0]?.snapshot.note,
      ).toBeNull();
      markSnapshotReady();
      await continueSnapshot;
      expect(
        (await store.selectedAtGeneration(user, '1', [{ id, taskId }]))[0]?.snapshot.note,
      ).toBeNull();
    }, true);
    await snapshotReady;
    await inTenant(async (scope) => {
      const store = records(scope);
      await store.findById(user, id, true);
      await store.save(changed);
    });
    finishSnapshot();
    await concurrentRead;
    await expect(
      inTenant((scope) => records(scope).pageAtGeneration(user, '1', 10, null), true),
    ).rejects.toBeInstanceOf(ReminderGenerationChanged);
    await inTenant(async (scope) => {
      expect(await records(scope).selectedAtGeneration(user, '2', [{ id, taskId }])).toHaveLength(
        1,
      );
      expect(await records(scope).selectedAtGeneration(user, '2', [{ id, taskId: user }])).toEqual(
        [],
      );
      await expect(records(scope).selectedAtGeneration(user, '1', [])).rejects.toBeInstanceOf(
        ReminderGenerationChanged,
      );
    }, true);

    await expect(
      inTenant(async (scope) => {
        const store = records(scope);
        await store.findById(user, id, true);
        await store.save(changed.changeNote('Rolled back'));
        throw new Error('rollback reminder');
      }),
    ).rejects.toThrow('rollback reminder');
    expect(
      (await inTenant((scope) => records(scope).pageAtGeneration(user, '2', 10, null), true))
        .generation,
    ).toBe('2');
    await inTenant(async (scope) => {
      const store = records(scope);
      await store.findById(user, id, true);
      await store.remove(changed);
    });
    expect(
      (await inTenant((scope) => records(scope).pageAtGeneration(user, '3', 10, null), true)).items,
    ).toEqual([]);
  });

  it('scans an empty inbox in a read-only transaction without creating an owner row', async () => {
    const tenant = service().get<TenantTransactionRunner>(TenantTransactionRunner);
    const user = '019a7000-1a2b-7c3d-8e4f-5a6b7c8d9099';
    await runWithOrganizationContext(memberOf(atelierNordId), () =>
      tenant.run(
        async (scope) => {
          const records = new DrizzleInboxRecords(scope, () => Promise.resolve());
          expect(await records.unreadSubjects(atelierNordId, user, null, null, 10)).toEqual({
            generation: '0',
            items: [],
            next: null,
          });
          expect(await records.unreadSubjects(atelierNordId, user, '0', null, 10)).toEqual({
            generation: '0',
            items: [],
            next: null,
          });
          await expect(
            records.unreadSubjects(atelierNordId, user, '1', null, 10),
          ).rejects.toBeInstanceOf(InboxGenerationChanged);
          const rows = await scope.client.query(
            'select recipient_id from inbox_generations where organization_id = $1 and recipient_id = $2',
            [atelierNordId, user],
          );
          expect(rows.rows).toEqual([]);
        },
        { readOnly: true },
      ),
    );
  });

  it('pins inbox scans and read-all to the owner generation and original creation cutoff', async () => {
    const tenant = service().get<TenantTransactionRunner>(TenantTransactionRunner);
    const user = camilleMartinId;
    const now = Date.parse('2026-11-08T09:00:00.000Z');
    const work = new DrizzleInboxRecordsUnitOfWork(tenant, async (scope, fact) => {
      await scope.client.query(
        `insert into outbox_events
           (id, event_name, subject, stream, organization_id, payload, status, sent_at)
         values (uuidv7(), 'notification.inbox-test.v1', 'evt.notification.inbox-test.v1',
                 'EVENTS', $1, $2::jsonb, 'sent', now())`,
        [fact.organizationId, JSON.stringify(fact)],
      );
    });
    const inOwner = <T>(fn: Parameters<typeof work.run<T>>[1]): Promise<T> =>
      runWithOrganizationContext(memberOf(atelierNordId), () => work.run(atelierNordId, fn));
    const create = async (
      sourceEventId: string,
      subject: { readonly kind: 'task-key'; readonly taskKey: string } | null,
      fail = false,
    ): Promise<{ readonly id: string; readonly inserted: boolean }> =>
      inOwner(async (records) => {
        const id = await records.newId(atelierNordId);
        const { notification, fact } = InboxNotification.create({
          id,
          organizationId: atelierNordId,
          recipientId: user,
          kind: 'mention',
          actorUserId: null,
          subject: null,
          createdAt: now,
        });
        const inserted = await records.insert(
          atelierNordId,
          user,
          sourceEventId,
          notification,
          fact,
          { subject },
        );
        if (fail) throw new Error('Rollback probe');
        return { id, inserted };
      });
    const first = '019a7000-1a2b-7c3d-8e4f-5a6b7c8d9011';
    const second = '019a7000-1a2b-7c3d-8e4f-5a6b7c8d9012';
    const third = '019a7000-1a2b-7c3d-8e4f-5a6b7c8d9013';
    const visible = { kind: 'task-key' as const, taskKey: 'CAD-482' };
    const hidden = { kind: 'task-key' as const, taskKey: 'CAD-483' };
    const firstItem = await create(first, visible);
    expect(firstItem.inserted).toBe(true);
    expect((await create(first, visible)).inserted).toBe(false);
    await create(second, hidden);
    const self = await inOwner(async (records) => {
      const id = await records.newId(atelierNordId);
      const { notification, fact } = InboxNotification.create({
        id,
        organizationId: atelierNordId,
        recipientId: user,
        kind: 'mention',
        actorUserId: user,
        subject: null,
        createdAt: now,
      });
      return records.insert(atelierNordId, user, third, notification, fact, { subject: visible });
    });
    expect(self).toBe(false);
    await expect(create(third, visible, true)).rejects.toThrow('Rollback probe');
    const page = await inOwner((records) =>
      records.unreadSubjects(atelierNordId, user, null, null, 1),
    );
    expect(page.generation).toBe('2');
    expect(page.items).toEqual([{ subject: visible, count: 1 }]);
    expect(page.next).not.toBeNull();
    const continuation = await inOwner((records) =>
      records.unreadSubjects(atelierNordId, user, '2', page.next, 1),
    );
    expect(continuation.items).toEqual([{ subject: hidden, count: 1 }]);
    await create(third, visible);
    await expect(
      inOwner((records) => records.unreadSubjects(atelierNordId, user, '2', page.next, 1)),
    ).rejects.toBeInstanceOf(InboxGenerationChanged);
    await expect(
      inOwner((records) => records.readAll(atelierNordId, user, '2', '2', [visible], now + 1000)),
    ).rejects.toBeInstanceOf(InboxGenerationChanged);
    expect(
      await inOwner((records) =>
        records.readAll(atelierNordId, user, '3', '2', [visible], now + 1000),
      ),
    ).toEqual({ markedRead: 1, unreadCount: 1 });
    const result = await inOwner((records) =>
      records.findCandidate(atelierNordId, user, firstItem.id),
    );
    expect(result?.readAt).toBe('2026-11-08T09:00:01.000Z');
    expect(
      await inOwner((records) =>
        records.change(atelierNordId, user, firstItem.id, hidden, 'archive', [999], now + 2000),
      ),
    ).toEqual({ kind: 'not-found' });
    expect(
      await inOwner((records) =>
        records.change(atelierNordId, user, firstItem.id, visible, 'archive', [1], now + 2000),
      ),
    ).toEqual({ kind: 'version-mismatch', currentVersion: 2 });
    expect(
      (
        await inOwner((records) =>
          records.change(atelierNordId, user, firstItem.id, visible, 'archive', [1, 2], now + 2000),
        )
      ).kind,
    ).toBe('ok');
    const other = await runWithOrganizationContext(memberOf(otherOrganizationId), () =>
      work.run(otherOrganizationId, (records) =>
        records.findCandidate(otherOrganizationId, user, firstItem.id),
      ),
    );
    expect(other).toBeNull();
    const ownerOnly = '019a7000-1a2b-7c3d-8e4f-5a6b7c8d9014';
    await create(ownerOnly, null);
    expect(
      (await inOwner((records) => records.unreadSubjects(atelierNordId, user, '6', null, 100)))
        .items,
    ).toContainEqual({ subject: null, count: 1 });
    expect(
      await inOwner((records) => records.readAll(atelierNordId, user, '6', '6', [], now + 3000)),
    ).toEqual({ markedRead: 1, unreadCount: 0 });
    const fifth = '019a7000-1a2b-7c3d-8e4f-5a6b7c8d9015';
    const [concurrentRead, concurrentCreate] = await Promise.allSettled([
      inOwner((records) =>
        records.readAll(atelierNordId, user, '7', '7', [visible, hidden], now + 4000),
      ),
      create(fifth, visible),
    ]);
    expect(concurrentCreate.status).toBe('fulfilled');
    if (concurrentCreate.status !== 'fulfilled') throw new Error('Concurrent creation failed.');
    expect(concurrentCreate.value.inserted).toBe(true);
    if (concurrentRead.status === 'fulfilled') {
      expect(concurrentRead.value).toEqual({ markedRead: 2, unreadCount: 0 });
    } else {
      expect(concurrentRead.reason).toBeInstanceOf(InboxGenerationChanged);
    }
    const arriving = await inOwner((records) =>
      records.findCandidate(atelierNordId, user, concurrentCreate.value.id),
    );
    expect(arriving?.readAt).toBeNull();
    const outboxCount = await inOwner(async () =>
      tenant.run((scope) =>
        scope.client.query(
          "select count(*)::int as count from outbox_events where organization_id = $1 and event_name = 'notification.inbox-test.v1'",
          [atelierNordId],
        ),
      ),
    );
    expect(outboxCount.rows).toEqual([{ count: 5 }]);
    await inOwner(async () =>
      tenant.run(async (scope) => {
        await scope.client.query(
          "delete from outbox_events where organization_id = $1 and event_name = 'notification.inbox-test.v1'",
          [atelierNordId],
        );
      }),
    );
  });

  it('stages each source recipient once and commits one inbox fact across concurrent permits', async () => {
    const tenant = service().get<TenantTransactionRunner>(TenantTransactionRunner);
    const sourceEventId = randomUUID();
    const userContext = memberOf(atelierNordId);
    const expiresAt = Date.now() + 30_000;
    const source = {
      organizationId: atelierNordId,
      sourceEventId,
      actorUserId: null,
      taskKey: 'CAD-482',
      commentId: null,
      status: null,
    };
    const work = new DrizzleInboxDeliveryUnitOfWork(
      tenant,
      writeInboxAuthorizationProbe,
      (scope, fact, subject) =>
        writeInboxProbe(scope, 'notification.inbox-created-test.v1', {
          notificationId: fact.notificationId,
          recipientId: fact.recipientId,
          subject,
        }),
      () => Promise.resolve(),
    );
    const staging = new StageInboxDeliveries(work, Date.now);
    const accept = new AcceptInboxDeliveryAuthorization(work, Date.now, () =>
      Promise.resolve(true),
    );
    const stage = (): Promise<number> =>
      runWithOrganizationContext(userContext, () =>
        staging.execute({
          source,
          audiences: [{ kind: 'assignment', recipientIds: [camilleMartinId, camilleMartinId] }],
          expiresAt,
        }),
      );

    const staged = await Promise.all([stage(), stage()]);
    expect(staged.sort()).toEqual([0, 1]);
    const attemptId = await runWithOrganizationContext(userContext, () =>
      tenant.run(async (scope) => {
        const result = await scope.client.query(
          'select id from inbox_delivery_authorization_attempts where source_event_id = $1',
          [sourceEventId],
        );
        const requests = await scope.client.query(
          "select id from outbox_events where payload->>'sourceEventId' = $1",
          [sourceEventId],
        );
        expect(requests.rows).toHaveLength(1);
        return inboxProbeField(result.rows[0], 'id');
      }),
    );
    const permit = {
      organizationId: atelierNordId,
      attemptId,
      decision: 'permit' as const,
      validUntil: expiresAt,
      decidedAt: Date.now(),
    };
    await expect(
      runWithOrganizationContext(memberOf(otherOrganizationId), () =>
        accept.execute({ ...permit, organizationId: otherOrganizationId }),
      ),
    ).resolves.toBe(false);
    const apply = (): Promise<boolean> =>
      runWithOrganizationContext(userContext, () => accept.execute(permit));
    const applied = await Promise.all([apply(), apply()]);
    expect(applied.sort()).toEqual([false, true]);

    await runWithOrganizationContext(userContext, () =>
      tenant.run(async (scope) => {
        const record = await scope.client.query(
          'select id, subject_value from inbox_notifications where source_event_id = $1',
          [sourceEventId],
        );
        expect(record.rows).toHaveLength(1);
        expect(inboxProbeField(record.rows[0], 'subject_value')).toBe(source.taskKey);
        const result = await scope.client.query(
          "select id from outbox_events where payload->>'notificationId' = $1",
          [inboxProbeField(record.rows[0], 'id')],
        );
        expect(result.rows).toHaveLength(1);
      }),
    );
  });

  it('rolls back inbox creation, outbox and permit when the fact writer fails', async () => {
    const tenant = service().get<TenantTransactionRunner>(TenantTransactionRunner);
    const sourceEventId = randomUUID();
    const userContext = memberOf(atelierNordId);
    let notificationId: string | undefined;
    let shouldFail = true;
    const work = new DrizzleInboxDeliveryUnitOfWork(
      tenant,
      writeInboxAuthorizationProbe,
      async (scope, fact) => {
        notificationId = fact.notificationId;
        await writeInboxProbe(scope, 'notification.inbox-created-test.v1', { notificationId });
        if (shouldFail) throw new Error('Simulated transactional inbox outbox failure.');
      },
      () => Promise.resolve(),
    );
    const staging = new StageInboxDeliveries(work, Date.now);
    const accept = new AcceptInboxDeliveryAuthorization(work, Date.now, () =>
      Promise.resolve(true),
    );
    const expiresAt = Date.now() + 30_000;
    await runWithOrganizationContext(userContext, () =>
      staging.execute({
        source: {
          organizationId: atelierNordId,
          sourceEventId,
          actorUserId: null,
          taskKey: 'CAD-482',
          commentId: null,
          status: null,
        },
        audiences: [{ kind: 'mention', recipientIds: [camilleMartinId] }],
        expiresAt,
      }),
    );
    const attemptId = await runWithOrganizationContext(userContext, () =>
      tenant.run(async (scope) => {
        const result = await scope.client.query(
          'select id from inbox_delivery_authorization_attempts where source_event_id = $1',
          [sourceEventId],
        );
        return inboxProbeField(result.rows[0], 'id');
      }),
    );
    const permit = {
      organizationId: atelierNordId,
      attemptId,
      decision: 'permit' as const,
      validUntil: expiresAt,
      decidedAt: Date.now(),
    };
    const apply = (): Promise<boolean> =>
      runWithOrganizationContext(userContext, () => accept.execute(permit));
    await expect(apply()).rejects.toThrow('Simulated transactional inbox outbox failure.');
    expect(notificationId).toBeDefined();
    await runWithOrganizationContext(userContext, () =>
      tenant.run(async (scope) => {
        const attempt = await scope.client.query(
          'select outcome from inbox_delivery_authorization_attempts where id = $1',
          [attemptId],
        );
        expect(inboxProbeField(attempt.rows[0], 'outcome')).toBe('pending');
        const inbox = await scope.client.query(
          'select id from inbox_notifications where source_event_id = $1',
          [sourceEventId],
        );
        const outbox = await scope.client.query(
          "select id from outbox_events where payload->>'notificationId' = $1",
          [notificationId],
        );
        expect(inbox.rows).toHaveLength(0);
        expect(outbox.rows).toHaveLength(0);
      }),
    );
    shouldFail = false;
    await expect(apply()).resolves.toBe(true);
    await expect(apply()).resolves.toBe(false);
  });

  it('uses the same notification preferences without a selected organization or after a switch', async () => {
    const system = service().get<SystemTransactionRunner>(SystemTransactionRunner);
    const tenant = service().get(TenantTransactionRunner);
    const work = new SystemPreferencesUnitOfWork(system);
    const read = new GetNotificationPreferences(work);
    const update = new UpdateNotificationPreferences(work);
    const userId = camilleMartinId;

    const defaults = await read.execute({ userId });
    expect(defaults).toMatchObject({ userId, digest: 'daily', version: 1 });
    await expect(update.execute({ userId, patch: { digest: 'daily' } })).resolves.toEqual(defaults);
    const saved = 'select user_id from notification_preferences where user_id = $1';
    expect((await system.run((tx) => tx.client.query(saved, [userId]))).rows).toEqual([]);

    const changed = await update.execute({
      userId,
      patch: { digest: 'weekly' },
      expectedVersions: [1, 3],
    });
    expect(changed).toMatchObject({ userId, digest: 'weekly', version: 2 });
    for (const organization of [atelierNordId, otherOrganizationId]) {
      await expect(
        runWithOrganizationContext(memberOf(organization), () =>
          read.execute({ userId: userId.toUpperCase() }),
        ),
      ).resolves.toEqual(changed);
    }

    const otherUser = '01938f6e-0000-7000-8000-000000000003';
    await expect(work.run(otherUser, (store) => store.find(userId))).rejects.toThrow();
    await expect(read.execute({ userId: otherUser })).resolves.toMatchObject({
      userId: otherUser,
      digest: 'daily',
      version: 1,
    });
    const tenantRows = await runWithOrganizationContext(memberOf(atelierNordId), () =>
      tenant.run((tx) => tx.client.query(saved, [userId])),
    );
    expect(tenantRows.rows).toEqual([]);
  });

  it('limits tenant preference reads to the selected recipient without granting writes', async () => {
    const tenant = service().get(TenantTransactionRunner);
    const system = service().get<SystemTransactionRunner>(SystemTransactionRunner);
    const update = new UpdateNotificationPreferences(new SystemPreferencesUnitOfWork(system));
    const firstUser = randomUUID();
    const secondUser = randomUUID();
    for (const userId of [firstUser, secondUser]) {
      await update.execute({ userId, patch: { digest: 'weekly' } });
    }

    await runWithOrganizationContext(memberOf(atelierNordId), () =>
      tenant.run(async (scope) => {
        await scope.client.query("select set_config('app.notification_recipient_id', $1, true)", [
          firstUser,
        ]);
        const visible = await scope.client.query(
          'select user_id from notification_preferences where user_id = any($1::uuid[])',
          [[firstUser, secondUser]],
        );
        expect(visible.rows).toEqual([{ user_id: firstUser }]);
        const changed = await scope.client.query(
          "update notification_preferences set digest = 'daily' where user_id = $1 returning user_id",
          [firstUser],
        );
        expect(changed.rows).toEqual([]);
        await scope.client.query("select set_config('app.notification_recipient_id', '', true)");
        const afterReset = await scope.client.query(
          'select user_id from notification_preferences where user_id = any($1::uuid[])',
          [[firstUser, secondUser]],
        );
        expect(afterReset.rows).toEqual([]);
      }),
    );
    await expect(
      runWithOrganizationContext(memberOf(atelierNordId), () =>
        tenant.run(async (scope) => {
          await scope.client.query("select set_config('app.notification_recipient_id', $1, true)", [
            firstUser,
          ]);
          await scope.client.query(
            `insert into notification_preferences (user_id, channels, digest, do_not_disturb, version)
             select $2, channels, digest, do_not_disturb, version
             from notification_preferences where user_id = $1`,
            [firstUser, randomUUID()],
          );
        }),
      ),
    ).rejects.toMatchObject({ code: '42501' });

    const pool = service().get<pg.Pool>(DATABASE_POOL);
    const connection = await pool.connect();
    try {
      await connection.query('begin');
      await connection.query("select set_config('app.notification_recipient_id', $1, true)", [
        firstUser,
      ]);
      const withoutOrganization = await connection.query(
        'select user_id from notification_preferences where user_id = $1',
        [firstUser],
      );
      expect(withoutOrganization.rows).toEqual([]);
    } finally {
      await connection.query('rollback');
      connection.release();
    }
    await expect(
      new GetNotificationPreferences(new SystemPreferencesUnitOfWork(system)).execute({
        userId: firstUser,
      }),
    ).resolves.toMatchObject({ digest: 'weekly', version: 2 });
  });

  it('serializes the first effective preferences writes before reading the default version', async () => {
    const system = service().get<SystemTransactionRunner>(SystemTransactionRunner);
    const work = new SystemPreferencesUnitOfWork(system);
    const update = new UpdateNotificationPreferences(work);
    const userId = '01938f6e-0000-7000-8000-000000000004';
    let markLocked: () => void = () => undefined;
    const locked = new Promise<void>((resolve) => {
      markLocked = resolve;
    });
    let releaseFirst: () => void = () => undefined;
    const released = new Promise<void>((resolve) => {
      releaseFirst = resolve;
    });

    const first = work.run(userId, async (store) => {
      await store.lockAccount(userId);
      markLocked();
      await released;
      return update.execute({ userId, patch: { digest: 'weekly' }, expectedVersions: [1] });
    });
    await Promise.race([locked, first]);
    const second = update.execute({
      userId,
      patch: { doNotDisturb: false },
      expectedVersions: [1],
    });
    const results = Promise.allSettled([first, second]);
    try {
      await vi.waitFor(async () => {
        const waiting = await migrator.query<{ waiting: boolean }>(
          `select exists (
             select 1 from pg_locks
             where locktype = 'advisory' and not granted
               and database = (select oid from pg_database where datname = current_database())
           ) as waiting`,
        );
        expect(waiting.rows).toEqual([{ waiting: true }]);
      });
    } finally {
      releaseFirst();
      await results;
    }

    const [written, stale] = await results;
    expect(written).toMatchObject({ status: 'fulfilled', value: { digest: 'weekly', version: 2 } });
    expect(stale).toMatchObject({ status: 'rejected', reason: { currentVersion: 2 } });
    await expect(new GetNotificationPreferences(work).execute({ userId })).resolves.toMatchObject({
      digest: 'weekly',
      doNotDisturb: true,
      version: 2,
    });
  });

  it('refuses any change of structure to the application role', async () => {
    const system = service().get(SystemTransactionRunner);
    const statements = [
      'create table wiring_probe (id integer)',
      'alter table outbox_events add column wiring_probe integer',
      'alter table outbox_events no force row level security',
      'drop table processed_events',
      'truncate idempotency_keys',
      'create schema wiring_probe',
    ];

    for (const statement of statements) {
      await expect(system.run((tx) => tx.client.query(statement))).rejects.toMatchObject({
        code: '42501',
      });
    }
  });

  it('keeps the migration journal out of reach of the application role', async () => {
    const system = service().get(SystemTransactionRunner);

    await expect(
      system.run((tx) => tx.client.query('delete from drizzle.__drizzle_migrations')),
    ).rejects.toMatchObject({ code: '42501', message: 'permission denied for schema drizzle' });

    const journal = await migrator.query<{ applied: number }>(
      'select count(*)::int as applied from drizzle.__drizzle_migrations',
    );
    expect(journal.rows).toEqual([{ applied: migrationCount }]);
  });

  it('publishes pending outbox events automatically and remains healthy', async () => {
    const tenant = service().get(TenantTransactionRunner);
    const id = '01938f6e-0000-7000-8000-000000000003';
    await runWithOrganizationContext(memberOf(atelierNordId), () =>
      tenant.run(async (tx) => {
        await tx.client.query(
          `insert into outbox_events (id, event_name, subject, stream, organization_id, payload)
           values ($1, 'notification.wiring-probe.v1', 'evt.notification.wiring-probe.v1', 'EVENTS', $2,
                   jsonb_build_object('id', $1::uuid::text, 'organizationId', $2::uuid::text))`,
          [id, atelierNordId],
        );
      }),
    );

    await vi.waitFor(
      async () => {
        const result = await runWithOrganizationContext(memberOf(atelierNordId), () =>
          tenant.run((tx) =>
            tx.client.query('select status from outbox_events where id = $1', [id]),
          ),
        );
        expect(result.rows).toEqual([{ status: 'sent' }]);
      },
      { timeout: 10_000, interval: 100 },
    );
    const response = await request(service().getHttpServer()).get('/health/ready');
    expect(response.status).toBe(200);
  });

  it('runs against a broker that enforces the permissions of cadenway-ops', () => {
    const notification = { NATS_USER: 'notification', NATS_PASSWORD: 'notification' };
    const inbox = ['--inbox-prefix', '_INBOX.notification'];

    // The three streams the dead-letter worker needs, on its own inbox prefix only.
    for (const stream of ['EVENTS', 'EVENTS_RESTRICTED', 'EVENTS_DLQ']) {
      expect(brokerAccepts(notification, ...inbox, 'stream', 'info', stream)).toBe(true);
    }
    expect(brokerAccepts(notification, 'stream', 'info', 'EVENTS')).toBe(false);
    expect(brokerAccepts(notification, 'pub', 'evt.task.wiring-probe', 'refused')).toBe(false);
    expect(
      brokerAccepts({ NATS_USER: '', NATS_PASSWORD: '' }, 'pub', 'evt.notification.x', 'x'),
    ).toBe(false);
  });

  it('copies a message another backend gave up on into EVENTS_DLQ, as the dead-letter worker', async () => {
    giveUpOn(
      'EVENTS',
      'task-service__wiring-probe',
      'evt.task.wiring-probe.v1',
      '{"taskId":"CAD-482"}',
    );
    giveUpOn(
      'EVENTS_RESTRICTED',
      'identity-service__wiring-probe',
      'restricted.user.wiring-probe.v1',
      '{"code":"482614"}',
    );

    const event = await vi.waitFor(
      () => lastDeadLetter('dlq.task-service__wiring-probe.evt.task.wiring-probe.v1'),
      { timeout: 15_000, interval: 500 },
    );
    expect(event.headers).toMatchObject({
      'Cadenway-Dead-Letter-Consumer': 'task-service__wiring-probe',
      'Cadenway-Dead-Letter-Reason': 'max-deliveries',
      'Cadenway-Dead-Letter-Deliveries': '1',
    });
    expect(event.body).toBe('{"taskId":"CAD-482"}');

    // The body of a restricted event may hold a single-use code: the copy keeps its headers only.
    const restricted = await vi.waitFor(
      () => lastDeadLetter('dlq.identity-service__wiring-probe.restricted.user.wiring-probe.v1'),
      { timeout: 15_000, interval: 500 },
    );
    expect(restricted.headers).toMatchObject({
      'Cadenway-Dead-Letter-Consumer': 'identity-service__wiring-probe',
      'Cadenway-Dead-Letter-Reason': 'max-deliveries',
      'Cadenway-Dead-Letter-Payload': 'dropped',
    });
    expect(restricted.body).toBe('');
  });

  it('stops being ready while NATS is down, and is ready again once it is back', async () => {
    compose('stop', 'nats');

    await vi.waitFor(
      async () => {
        const response = await request(service().getHttpServer()).get('/health/ready');
        expect(response.status).toBe(503);
        expect(response.body).toMatchObject({
          status: 'error',
          info: { postgres: { status: 'up' } },
          error: { nats: { status: 'down' } },
        });
      },
      { timeout: 10_000, interval: 250 },
    );

    compose('start', 'nats');

    await vi.waitFor(
      async () => {
        const response = await request(service().getHttpServer()).get('/health/ready');
        expect(response.status).toBe(200);
      },
      { timeout: 30_000, interval: 500 },
    );
  });

  it('stops being ready when its database is down', async () => {
    compose('stop', 'postgres');

    const response = await request(service().getHttpServer()).get('/health/ready');

    expect(response.status).toBe(503);
    expect(response.body).toMatchObject({
      status: 'error',
      error: { postgres: { status: 'down' } },
    });
  });

  it('answers 503 on readiness and 200 on liveness as soon as it shuts down', async () => {
    const running = service();
    const closing = running.close();

    await vi.waitFor(
      async () => {
        const response = await request(running.getHttpServer()).get('/health/ready');
        expect(response.status).toBe(503);
        expect(response.body).toMatchObject({
          error: { shutdown: { status: 'down', message: 'shutting down' } },
        });
      },
      { timeout: 5_000, interval: 50 },
    );
    const live = await request(running.getHttpServer()).get('/health/live');
    expect(live.status).toBe(200);

    releaseShutdown();
    await closing;
    app = undefined;
  });
});
