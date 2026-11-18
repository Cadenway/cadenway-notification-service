import { execFileSync } from 'node:child_process';
import { generateKeyPairSync } from 'node:crypto';
import { createServer } from 'node:net';
import { fileURLToPath } from 'node:url';

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
import { SystemTransactionRunner, TenantTransactionRunner } from '@cadenway/nest-common/database';
import { Controller, Get, Injectable, Module } from '@nestjs/common';
import type { BeforeApplicationShutdown } from '@nestjs/common';
import type { NestExpressApplication } from '@nestjs/platform-express';
import pg from 'pg';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import { AppModule } from '../src/app.module.js';
import { appConfigSchema } from '../src/config/app-config.js';

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

/** Every table of the service: the platform tables and those of the email module. */
const serviceTables = [
  'code_email_deliveries',
  'event_versions',
  'idempotency_keys',
  'invitation_email_deliveries',
  'outbox_events',
  'pending_code_emails',
  'pending_invitation_emails',
  'pending_security_emails',
  'processed_events',
  'security_email_deliveries',
] as const;

/** The migrations of the service, all applied by the migrator. */
const migrationCount = 5;

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
      { relname: 'invitation_email_deliveries', relrowsecurity: true, relforcerowsecurity: true },
      { relname: 'outbox_events', relrowsecurity: true, relforcerowsecurity: true },
      { relname: 'pending_code_emails', relrowsecurity: true, relforcerowsecurity: true },
      { relname: 'pending_invitation_emails', relrowsecurity: true, relforcerowsecurity: true },
      { relname: 'pending_security_emails', relrowsecurity: true, relforcerowsecurity: true },
      { relname: 'processed_events', relrowsecurity: false, relforcerowsecurity: false },
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
        tablename: 'invitation_email_deliveries',
        policyname: 'invitation_email_deliveries_organization_isolation',
      },
      { tablename: 'outbox_events', policyname: 'outbox_events_organization_isolation' },
      { tablename: 'pending_code_emails', policyname: 'pending_code_emails_system_access' },
      {
        tablename: 'pending_invitation_emails',
        policyname: 'pending_invitation_emails_organization_isolation',
      },
      { tablename: 'pending_security_emails', policyname: 'pending_security_emails_system_access' },
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
          counts.push((await tx.client.query(`delete from ${table} returning 1`)).rows.length);
        }
        return counts;
      }),
    );
    expect(deleted).toEqual([1, 1, 1, 1]);
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
