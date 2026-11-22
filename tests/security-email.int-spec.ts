import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { createServer } from 'node:net';
import { fileURLToPath } from 'node:url';
import { eventSchemas } from '@cadenway/contracts/events/identity-service';
import type { EventName } from '@cadenway/contracts/events/identity-service';
import { createApplication, loadConfig, runWithOrganizationContext } from '@cadenway/nest-common';
import { SystemTransactionRunner, TenantTransactionRunner } from '@cadenway/nest-common/database';
import type { NestExpressApplication } from '@nestjs/platform-express';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { AppModule } from '../src/app.module.js';
import { appConfigSchema } from '../src/config/app-config.js';
import { dateTimeLabel } from '../src/modules/email/infrastructure/adapters/templates/security-email-wording.js';

// The security e-mails of the account events end to end, on the dependencies of compose.dev.yaml
// started as a throwaway Compose project on free ports: PostgreSQL with the two roles of
// cadenway-ops, NATS with the authorization of cadenway-ops (`identity` publishes, `notification`
// reads through its own consumers only) and its three streams, and a disposable Mailpit that
// catches the e-mails and shows them on its HTTP API. The service runs as main.ts assembles it, as
// `notification_app` and the NATS user `notification`. A test never reaches the network.

/** Compose file of the development dependencies. */
const composeFile: string = fileURLToPath(new URL('../compose.dev.yaml', import.meta.url));

/** Throwaway project name, apart from the dev stack and from the other integration specs. */
const project = `cadenway-notification-service-security-test-${String(process.pid)}`;

/** The NATS user of identity-service, the publisher of the account events. */
const identity = { NATS_USER: 'identity', NATS_PASSWORD: 'identity' } as const;

/** The NATS user of this service. */
const notification = { NATS_USER: 'notification', NATS_PASSWORD: 'notification' } as const;

/** Camille Martin (CM), the member of Atelier Nord the mockup signs in as. */
const camilleMartin = {
  id: '01938f6e-8a42-7d5b-b2c9-5e1f3a6d9c24',
  email: 'camille.martin@ateliernord.fr',
  name: 'Camille Martin',
} as const;

/** Atelier Nord, the organization of the mockup. */
const atelierNordId = '01938f6e-6d1a-7c3e-9a51-2f0c4b8d7e10';

/** The secret of the reset link the specs issue: no log line nor stored row may hold it. */
const resetToken = 'rT7kQ2xVb9Lm4Np8Zc1Hs6Wd3Fg5Jy0A_-uEtokenOfTheIntegrationSpec';

/** The browser of the events, as identity-service reads it. */
const firefoxOnWindows = {
  device: {
    type: 'desktop',
    browser: 'Firefox',
    browserVersion: '132',
    os: 'Windows',
    osVersion: null,
  },
  ipAddress: '192.0.2.14',
} as const;

/** The durable consumer of each event, as the kit names it and cadenway-ops grants it. */
const consumers: Readonly<Record<string, { readonly stream: string; readonly name: string }>> = {
  'password-reset-link.issued.v1': {
    stream: 'EVENTS_RESTRICTED',
    name: 'notification-service__request-password-reset-email',
  },
  'user.password-changed.v1': {
    stream: 'EVENTS',
    name: 'notification-service__request-password-changed-email',
  },
  'user.email-changed.v1': {
    stream: 'EVENTS',
    name: 'notification-service__request-email-changed-email',
  },
  'session.opened-on-new-device.v1': {
    stream: 'EVENTS',
    name: 'notification-service__request-new-device-email',
  },
  'user.deletion-scheduled.v1': {
    stream: 'EVENTS',
    name: 'notification-service__request-deletion-scheduled-email',
  },
  'user.deletion-cancelled.v1': {
    stream: 'EVENTS',
    name: 'notification-service__request-deletion-cancelled-email',
  },
  'user.two-step-verification-changed.v1': {
    stream: 'EVENTS',
    name: 'notification-service__request-two-step-email',
  },
};

/** Host port of NATS, fixed for the run like in tests/service-wiring.int-spec.ts. */
let natsHostPort = '0';

/** Base URL of the HTTP API of Mailpit. */
let mailpitUrl = '';

/** Connection string of the migrator role, the owner of every table. */
let migratorUrl = '';

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
      env: {
        ...process.env,
        DEV_POSTGRES_PORT: '0',
        DEV_NATS_PORT: natsHostPort,
        DEV_SMTP_PORT: '0',
        DEV_MAILPIT_PORT: '0',
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    },
  );
}

/**
 * Runs the NATS command line of the `nats-streams` container, as `admin` or as another user.
 *
 * @param user - Credentials that replace those of `admin`, or `null` for `admin`.
 * @param args - Arguments of the `nats` command.
 * @returns The standard output; throws when the broker refuses the command.
 */
function nats(
  user: { readonly NATS_USER: string; readonly NATS_PASSWORD: string } | null,
  ...args: readonly string[]
): string {
  const variables = Object.entries(user ?? {}).flatMap(([name, value]) => [
    '--env',
    `${name}=${value}`,
  ]);
  return compose('exec', '-T', ...variables, 'nats-streams', 'nats', '--timeout', '2s', ...args);
}

/**
 * Whether the broker accepts a command of a user.
 *
 * @param user - Credentials of the user.
 * @param args - Arguments of the `nats` command.
 * @returns Whether the command succeeded.
 */
function natsAccepts(
  user: { readonly NATS_USER: string; readonly NATS_PASSWORD: string },
  ...args: readonly string[]
): boolean {
  try {
    nats(user, ...args);
    return true;
  } catch {
    return false;
  }
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
 * An identity-service event of Camille Martin that occurred now, checked against the schema of the
 * contract.
 *
 * @param name - Name of the event.
 * @param fields - The members proper to the event.
 * @returns The payload, as identity-service publishes it.
 */
function issued(
  name: EventName,
  fields: Readonly<Record<string, unknown>>,
): { readonly id: string } {
  return eventSchemas[name].parse({
    id: randomUUID(),
    occurredAt: new Date().toISOString(),
    organizationId: null,
    actor: { type: 'user', id: camilleMartin.id },
    userId: camilleMartin.id,
    language: 'en',
    timeZone: 'Europe/Paris',
    ...fields,
  });
}

/**
 * Publishes an event as identity-service does, as the `identity` user: a restricted one on
 * `restricted.<name>` into `EVENTS_RESTRICTED`, another on `evt.<name>` into `EVENTS`.
 *
 * @param name - Name of the event.
 * @param event - The payload.
 * @param messageId - `Nats-Msg-Id`; the event id unless a redelivery is simulated.
 */
function publishAsIdentity(
  name: EventName,
  event: { readonly id: string },
  messageId: string,
): void {
  const subject: string =
    consumers[name]?.stream === 'EVENTS_RESTRICTED' ? `restricted.${name}` : `evt.${name}`;
  nats(
    identity,
    '--inbox-prefix',
    '_INBOX.identity',
    'pub',
    '--jetstream',
    '--header',
    `Nats-Msg-Id:${messageId}`,
    '--header',
    `Cadenway-Event-Name:${name}`,
    subject,
    JSON.stringify(event),
  );
}

/**
 * Waits until the consumer of an event has acknowledged every message of its stream.
 *
 * @param name - Name of the event.
 */
async function waitUntilHandled(name: EventName): Promise<void> {
  const consumer = consumers[name];
  if (consumer === undefined) {
    throw new Error(`No consumer for ${name}.`);
  }
  await vi.waitFor(
    () => {
      const info = JSON.parse(
        nats(null, 'consumer', 'info', consumer.stream, consumer.name, '--json'),
      ) as { readonly num_pending: number; readonly num_ack_pending: number };
      expect({ pending: info.num_pending, acknowledging: info.num_ack_pending }).toEqual({
        pending: 0,
        acknowledging: 0,
      });
    },
    { timeout: 30_000, interval: 250 },
  );
}

/** A message of Mailpit, as its list returns it. */
interface MailpitSummary {
  readonly ID: string;
  readonly MessageID: string;
  readonly Subject: string;
}

/** A message of Mailpit, as its detail returns it. */
interface MailpitMessage extends MailpitSummary {
  readonly From: { readonly Name: string; readonly Address: string };
  readonly To: readonly { readonly Name: string; readonly Address: string }[];
  readonly Text: string;
  readonly HTML: string;
}

/**
 * Reads a route of the HTTP API of Mailpit.
 *
 * @param path - Path of the route.
 * @returns The JSON answer.
 */
async function mailpit<TBody>(path: string): Promise<TBody> {
  const response = await fetch(`${mailpitUrl}${path}`);
  expect(response.status).toBe(200);
  return (await response.json()) as TBody;
}

/**
 * Waits until Mailpit holds a number of messages.
 *
 * @param total - The number of messages expected.
 * @returns The messages, newest first.
 */
async function waitForMessages(total: number): Promise<readonly MailpitSummary[]> {
  return vi.waitFor(
    async () => {
      const list = await mailpit<{
        readonly total: number;
        readonly messages: readonly MailpitSummary[];
      }>('/api/v1/messages');
      expect(list.total).toBe(total);
      return list.messages;
    },
    { timeout: 30_000, interval: 250 },
  );
}

/**
 * Reads the newest message of Mailpit with its headers.
 *
 * @param total - The number of messages expected once it arrived.
 * @returns The message and its headers.
 */
async function latestMessage(total: number): Promise<{
  readonly message: MailpitMessage;
  readonly headers: Readonly<Record<string, readonly string[]>>;
}> {
  const [latest] = await waitForMessages(total);
  if (latest === undefined) {
    throw new Error('Mailpit holds no message.');
  }
  return {
    message: await mailpit<MailpitMessage>(`/api/v1/message/${latest.ID}`),
    headers: await mailpit<Readonly<Record<string, readonly string[]>>>(
      `/api/v1/message/${latest.ID}/headers`,
    ),
  };
}

describe('security e-mails', () => {
  const lines: string[] = [];
  let app: NestExpressApplication | undefined;

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

  /**
   * Reads the send log, as the system runner of the service sees it.
   *
   * @param eventId - Id of the event.
   * @returns Its deliveries, with whether a pending content remains.
   */
  async function deliveriesOf(eventId: string): Promise<
    readonly {
      readonly id: string;
      readonly template: string;
      readonly status: string;
      readonly skip_reason: string | null;
      readonly sent: boolean;
      readonly pending: boolean;
    }[]
  > {
    return service()
      .get(SystemTransactionRunner)
      .run(async (tx) => {
        const result = await tx.client.query(
          `select d.id, d.template, d.status, d.skip_reason, d.sent_at is not null as sent,
                  exists (select 1 from pending_security_emails p where p.delivery_id = d.id)
                    as pending
             from security_email_deliveries d
            where d.event_id = $1`,
          [eventId],
        );
        return result.rows as {
          readonly id: string;
          readonly template: string;
          readonly status: string;
          readonly skip_reason: string | null;
          readonly sent: boolean;
          readonly pending: boolean;
        }[];
      });
  }

  /**
   * Waits until the job of a delivery has settled it.
   *
   * @param eventId - Id of the event.
   */
  async function waitUntilSettled(eventId: string): Promise<void> {
    await vi.waitFor(
      async () => {
        const deliveries = await deliveriesOf(eventId);
        expect(deliveries).toHaveLength(1);
        expect(deliveries.map((delivery) => delivery.status)).not.toContain('queued');
      },
      { timeout: 30_000, interval: 250 },
    );
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
      'mailpit',
    );
    const postgresPort = hostPort('postgres', '5432');
    mailpitUrl = `http://127.0.0.1:${hostPort('mailpit', '8025')}`;
    migratorUrl = `postgres://notification_migrator:notification_migrator@127.0.0.1:${postgresPort}/notification`;

    vi.stubEnv('MIGRATION_DATABASE_URL', migratorUrl);
    vi.resetModules();
    const log = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    try {
      await import('../src/migrate.js');
    } finally {
      log.mockRestore();
    }

    vi.stubEnv('PORT', '3016');
    vi.stubEnv('LOG_PRETTY', 'false');
    vi.stubEnv('LOG_LEVEL', 'debug');
    vi.stubEnv(
      'DATABASE_URL',
      `postgres://notification_app:notification_app@127.0.0.1:${postgresPort}/notification`,
    );
    vi.stubEnv('NATS_URL', `nats://127.0.0.1:${natsHostPort}`);
    vi.stubEnv('NATS_USER', 'notification');
    vi.stubEnv('NATS_PASSWORD', 'notification');
    vi.stubEnv('INTERNAL_TOKEN_AUDIENCE', 'notification-service');
    vi.stubEnv('INTERNAL_TOKEN_PRIVATE_JWK', '');
    vi.stubEnv('IDENTITY_SERVICE_URL', '');
    vi.stubEnv(
      'INTERNAL_TOKEN_TRUSTED_ISSUERS',
      '{"api-gateway":[{"kty":"OKP","crv":"Ed25519","x":"MVZQc5h6AXxnMpaBTaYw5kI-yWWawl6zp8Srhuf5NK0","kid":"local-placeholder"}]}',
    );
    vi.stubEnv('SMTP_HOST', '127.0.0.1');
    vi.stubEnv('SMTP_ALLOW_INSECURE_LOCAL', 'true');
    vi.stubEnv('SMTP_PORT', hostPort('mailpit', '1025'));
    vi.stubEnv('MAIL_FROM', 'no-reply@cadenway.localhost');
    vi.stubEnv('WEB_APP_URL', 'http://app.cadenway.localhost');

    const config = loadConfig(appConfigSchema);
    app = await createApplication(AppModule, {
      service: 'notification-service',
      config,
      provideConfig: true,
      internalToken: {
        verifier: {
          audience: config.INTERNAL_TOKEN_AUDIENCE,
          trustedIssuers: config.INTERNAL_TOKEN_TRUSTED_ISSUERS,
        },
      },
      // Every line the service writes, at debug level, for the check that no token leaks.
      logDestination: {
        write: (line: string): boolean => {
          lines.push(line);
          return true;
        },
      },
    });
    await app.init();
  });

  afterAll(async () => {
    try {
      await app?.close();
    } finally {
      vi.unstubAllEnvs();
      compose('down', '--volumes', '--remove-orphans');
    }
  });

  /** The reset link of the first spec, delivered again by a later one. */
  const reset = issued('password-reset-link.issued.v1', {
    actor: { type: 'system', id: 'identity-service' },
    version: 1,
    linkId: randomUUID(),
    token: resetToken,
    expiresAt: new Date(Date.now() + 30 * 60_000).toISOString(),
    client: firefoxOnWindows,
    recipient: { email: camilleMartin.email, name: camilleMartin.name },
  });

  it('receives the restricted reset link published as identity and e-mails it through Mailpit', async () => {
    publishAsIdentity('password-reset-link.issued.v1', reset, reset.id);

    const { message, headers } = await latestMessage(1);

    expect(message.Subject).toBe('Réinitialisez votre mot de passe Cadenway');
    expect(message.From).toEqual({ Name: 'Cadenway', Address: 'no-reply@cadenway.localhost' });
    expect(message.To).toEqual([{ Name: camilleMartin.name, Address: camilleMartin.email }]);
    expect(message.Text).toContain(
      `Choisir un nouveau mot de passe : http://app.cadenway.localhost/reset#token=${resetToken}`,
    );
    expect(message.Text).toContain('Le lien expire dans 30 minutes.');
    expect(message.Text).toContain('Appareil : Firefox sur Windows');
    expect(message.Text).toContain('Adresse IP : 192.0.2.14');
    expect(message.HTML).toContain('Sécurité · toujours envoyé');
    expect(message.HTML).toContain(`http://app.cadenway.localhost/reset#token&#x3D;${resetToken}`);
    // A security e-mail cannot be turned off: it offers no unsubscription.
    expect(headers).not.toHaveProperty('List-Unsubscribe');
    expect(headers).not.toHaveProperty('List-Unsubscribe-Post');

    await waitUntilSettled(reset.id);
    const deliveries = await deliveriesOf(reset.id);
    expect(deliveries).toEqual([
      {
        id: expect.any(String) as string,
        template: 'password-reset',
        status: 'sent',
        skip_reason: null,
        sent: true,
        pending: false,
      },
    ]);
    expect(message.MessageID).toBe(`${deliveries[0]?.id ?? ''}@cadenway.localhost`);
  });

  it('sends "Mot de passe modifié" with the sessions the reset actually closed', async () => {
    const changed = issued('user.password-changed.v1', {
      version: 4,
      method: 'reset',
      closedSessionCount: 2,
      client: firefoxOnWindows,
      recipient: { email: camilleMartin.email, name: camilleMartin.name },
    });

    publishAsIdentity('user.password-changed.v1', changed, changed.id);

    const { message } = await latestMessage(2);
    expect(message.Subject).toBe('Votre mot de passe a été modifié');
    expect(message.Text).toContain(
      'Le mot de passe de votre compte vient d’être modifié. Par sécurité, vos 2 autres sessions ont été fermées.',
    );
    expect(message.Text).toContain('Sécuriser mon compte : http://app.cadenway.localhost/forgot');
    await waitUntilSettled(changed.id);
  });

  it('sends the notice of a changed address to the previous address', async () => {
    const changed = issued('user.email-changed.v1', {
      version: 5,
      email: 'camille@ateliernord.fr',
      previousEmail: camilleMartin.email,
      name: camilleMartin.name,
      client: firefoxOnWindows,
    }) as { readonly id: string; readonly occurredAt: string };

    publishAsIdentity('user.email-changed.v1', changed, changed.id);

    const { message } = await latestMessage(3);
    expect(message.Subject).toBe('L’adresse e-mail de votre compte a été modifiée');
    expect(message.To).toEqual([{ Name: camilleMartin.name, Address: camilleMartin.email }]);
    expect(message.Text).toContain(
      'L’adresse e-mail de votre compte a été remplacée par camille@ateliernord.fr',
    );
    expect(message.Text).toContain(
      `Date : ${dateTimeLabel(new Date(changed.occurredAt), 'Europe/Paris')}`,
    );
  });

  it('sends "Nouvelle connexion" with the browser in the subject and the IP address', async () => {
    const opened = issued('session.opened-on-new-device.v1', {
      version: 1,
      sessionId: randomUUID(),
      client: {
        device: {
          type: 'mobile',
          browser: 'Safari',
          browserVersion: '18',
          os: 'iOS',
          osVersion: '18.1',
        },
        ipAddress: '86.247.12.30',
      },
      recipient: { email: camilleMartin.email, name: camilleMartin.name },
    });

    publishAsIdentity('session.opened-on-new-device.v1', opened, opened.id);

    const { message } = await latestMessage(4);
    expect(message.Subject).toBe('Nouvelle connexion depuis Safari sur iOS');
    expect(message.Text).toContain('Appareil : Safari sur iOS 18.1');
    expect(message.Text).toContain('Adresse IP : 86.247.12.30');
    expect(message.Text).toContain(
      'Vérifier mes sessions : http://app.cadenway.localhost/account/security',
    );
  });

  it('sends "Suppression du compte" dated from deleteAt', async () => {
    const scheduled = issued('user.deletion-scheduled.v1', {
      version: 6,
      deleteAt: '2026-12-09T15:30:00.000Z',
      recipient: { email: camilleMartin.email, name: camilleMartin.name },
    });

    publishAsIdentity('user.deletion-scheduled.v1', scheduled, scheduled.id);

    const { message } = await latestMessage(5);
    expect(message.Subject).toBe('La suppression de votre compte est programmée');
    expect(message.Text).toContain('SUPPRESSION PROGRAMMÉE LE 9 DÉCEMBRE');
    expect(message.Text).toContain(
      'Annuler la suppression : http://app.cadenway.localhost/account',
    );
  });

  it('sends the notice of a deletion cancelled by a sign-in', async () => {
    const cancelled = issued('user.deletion-cancelled.v1', {
      version: 7,
      sessionId: randomUUID(),
      client: firefoxOnWindows,
      recipient: { email: camilleMartin.email, name: camilleMartin.name },
    });

    publishAsIdentity('user.deletion-cancelled.v1', cancelled, cancelled.id);

    const { message } = await latestMessage(6);
    expect(message.Subject).toBe('La suppression de votre compte est annulée');
    expect(message.Text).toContain(
      'Une connexion à votre compte vient d’annuler sa suppression programmée',
    );
  });

  it('sends one e-mail when the same event is delivered again', async () => {
    // A new Nats-Msg-Id, so the broker stores it again and the consumer receives it again.
    publishAsIdentity('password-reset-link.issued.v1', reset, randomUUID());
    await waitUntilHandled('password-reset-link.issued.v1');

    expect(await waitForMessages(6)).toHaveLength(6);
    expect(await deliveriesOf(reset.id)).toHaveLength(1);
  });

  it('does not send a reset link that expired before it arrived', async () => {
    const issuedAt = Date.now() - 40 * 60_000;
    const expired = issued('password-reset-link.issued.v1', {
      occurredAt: new Date(issuedAt).toISOString(),
      actor: { type: 'system', id: 'identity-service' },
      version: 1,
      linkId: randomUUID(),
      token: resetToken.replace('rT7k', 'xP2m'),
      expiresAt: new Date(issuedAt + 30 * 60_000).toISOString(),
      client: firefoxOnWindows,
      recipient: { email: camilleMartin.email, name: camilleMartin.name },
    });

    publishAsIdentity('password-reset-link.issued.v1', expired, expired.id);
    await waitUntilHandled('password-reset-link.issued.v1');

    expect(await waitForMessages(6)).toHaveLength(6);
    expect(await deliveriesOf(expired.id)).toMatchObject([
      { status: 'skipped', skip_reason: 'expired', sent: false, pending: false },
    ]);
  });

  it('keeps the reset token out of every row of its database once the e-mail left', async () => {
    const client = new pg.Client({ connectionString: migratorUrl });
    await client.connect();
    try {
      // The migrator owns every table; row-level security is forced, so it opens the policies of
      // the system tables as the system runner of the kit does.
      await client.query(`select set_config('app.system_access', 'on', false)`);
      const tables = await client.query<{ readonly name: string }>(
        `select format('%I.%I', table_schema, table_name) as name
           from information_schema.tables
          where table_schema in ('public', 'pgboss', 'drizzle') and table_type = 'BASE TABLE'`,
      );
      expect(tables.rows.map((row) => row.name)).toContain('public.pending_security_emails');
      const holding: string[] = [];
      for (const { name } of tables.rows) {
        const found = await client.query<{ readonly count: number }>(
          `select count(*)::int as count from ${name} as t where t::text like $1`,
          [`%${resetToken.slice(0, 24)}%`],
        );
        if ((found.rows[0]?.count ?? 0) > 0) {
          holding.push(name);
        }
      }
      expect(holding).toEqual([]);
    } finally {
      await client.end();
    }
  });

  it('never writes the reset token, the link nor an address of the account in a log line', async () => {
    const deliveryId = (await deliveriesOf(reset.id))[0]?.id ?? '';
    const written = lines.join('');

    // The capture holds the lines of the handled events.
    expect(written).toContain(deliveryId);
    expect(written).not.toContain(resetToken.slice(0, 24));
    expect(written).not.toContain('reset#token');
    expect(written).not.toContain(camilleMartin.email);
    expect(written).not.toContain('camille@ateliernord.fr');
    expect(written).not.toContain('192.0.2.14');
  });

  it('keeps the send log and the pending contents out of every tenant transaction', async () => {
    const tenant = service().get(TenantTransactionRunner);

    const visible = await runWithOrganizationContext(
      {
        organizationId: atelierNordId,
        actor: { type: 'user', id: camilleMartin.id },
        role: null,
        scopes: [],
      },
      () =>
        tenant.run(async (tx) => {
          const result = await tx.client.query(
            `select (select count(*)::int from security_email_deliveries) as deliveries,
                    (select count(*)::int from pending_security_emails) as pending`,
          );
          return result.rows[0] as { readonly deliveries: number; readonly pending: number };
        }),
    );

    expect(visible).toEqual({ deliveries: 0, pending: 0 });
    expect((await deliveriesOf(reset.id)).length).toBe(1);
  });

  it('schedules the sweep of the security e-mails every 5 minutes in UTC', async () => {
    const schedules = await service()
      .get(SystemTransactionRunner)
      .run(async (tx) => {
        const rows = await tx.client.query(
          `select name, cron, timezone from pgboss.schedule where name = 'email.expire-security'`,
        );
        return rows.rows as readonly Readonly<Record<string, string>>[];
      });

    expect(schedules).toEqual([
      { name: 'email.expire-security', cron: '*/5 * * * *', timezone: 'UTC' },
    ]);
  });

  it('reads through its granted consumers only: no other name, no other filter', () => {
    const inbox = ['--inbox-prefix', '_INBOX.notification'];
    const add = (stream: string, name: string, filter: string): boolean =>
      natsAccepts(
        notification,
        ...inbox,
        'consumer',
        'add',
        stream,
        name,
        '--pull',
        '--filter',
        filter,
        '--deliver',
        'new',
        '--defaults',
      );

    expect(add('EVENTS', 'notification-service__not-granted', 'evt.user.password-changed.v1')).toBe(
      false,
    );
    expect(
      add(
        'EVENTS_RESTRICTED',
        'notification-service__not-granted',
        'restricted.password-reset-link.issued.v1',
      ),
    ).toBe(false);
    expect(
      add('EVENTS', 'notification-service__request-password-changed-email', 'evt.user.deleted.v1'),
    ).toBe(false);
    expect(
      add(
        'EVENTS',
        'organization-service__project-user-email-changed',
        'evt.user.email-changed.v1',
      ),
    ).toBe(false);
    for (const { stream, name } of Object.values(consumers)) {
      expect(natsAccepts(notification, ...inbox, 'consumer', 'info', stream, name)).toBe(true);
    }
    // The publisher of the restricted events may not read them, through any consumer.
    expect(
      natsAccepts(
        identity,
        '--inbox-prefix',
        '_INBOX.identity',
        'consumer',
        'next',
        'EVENTS_RESTRICTED',
        'notification-service__request-password-reset-email',
        '--no-ack',
      ),
    ).toBe(false);
  });

  describe('two-step verification', () => {
    /** The name Camille Martin gives her key: an ampersand the HTML part must escape. */
    const keyName = 'Clé d’Hugo & Camille';

    /**
     * A change of the two-step verification of Camille Martin, as identity-service publishes it.
     *
     * @param change - `change` of the event.
     * @param fields - Members to change.
     * @returns The payload.
     */
    function twoStepChanged(
      change: string,
      fields: Readonly<Record<string, unknown>> = {},
    ): { readonly id: string; readonly occurredAt: string } {
      return issued('user.two-step-verification-changed.v1', {
        version: 8,
        change,
        enabled: change !== 'disabled',
        methods: change === 'disabled' ? [] : ['authenticator-app', 'security-key'],
        backupCodesRemaining: change === 'disabled' ? 0 : 10,
        securityKey: change.startsWith('security-key-')
          ? { id: randomUUID(), name: keyName }
          : null,
        client: firefoxOnWindows,
        recipient: { email: camilleMartin.email, name: camilleMartin.name },
        ...fields,
      }) as { readonly id: string; readonly occurredAt: string };
    }

    /**
     * Counts the messages Mailpit holds.
     *
     * @returns Their number.
     */
    async function messageCount(): Promise<number> {
      return (await mailpit<{ readonly total: number }>('/api/v1/messages')).total;
    }

    /**
     * Reads the e-mail of an event once its job sent it, found by its `Message-ID`, which derives
     * from the id of its delivery.
     *
     * @param eventId - Id of the event.
     * @returns The message, its headers and how many messages carry its `Message-ID`.
     */
    async function emailOf(eventId: string): Promise<{
      readonly message: MailpitMessage;
      readonly headers: Readonly<Record<string, readonly string[]>>;
      readonly copies: number;
    }> {
      await waitUntilSettled(eventId);
      const [delivery] = await deliveriesOf(eventId);
      expect(delivery).toMatchObject({ status: 'sent', sent: true, pending: false });
      const messageId = `${delivery?.id ?? ''}@cadenway.localhost`;
      const found = await vi.waitFor(
        async () => {
          const list = await mailpit<{ readonly messages: readonly MailpitSummary[] }>(
            '/api/v1/messages?limit=200',
          );
          const matching = list.messages.filter((summary) => summary.MessageID === messageId);
          expect(matching.length).toBeGreaterThan(0);
          return matching;
        },
        { timeout: 30_000, interval: 250 },
      );
      const [summary] = found;
      if (summary === undefined) {
        throw new Error(`No e-mail carries ${messageId}.`);
      }
      return {
        message: await mailpit<MailpitMessage>(`/api/v1/message/${summary.ID}`),
        headers: await mailpit<Readonly<Record<string, readonly string[]>>>(
          `/api/v1/message/${summary.ID}/headers`,
        ),
        copies: found.length,
      };
    }

    /** The first change of the block, delivered again by a later spec. */
    const enabled = twoStepChanged('enabled', { timeZone: 'America/New_York' });

    /** The deliveries of the key changes, which the log lines name by their ids. */
    const keyDeliveryIds: string[] = [];

    it.each<[string, string, readonly string[]]>([
      [
        'enabled',
        'La vérification en deux étapes est activée',
        [
          'Méthode : Application d’authentification',
          'Codes de secours : 10 codes générés',
          `Activée le : ${dateTimeLabel(new Date(enabled.occurredAt), 'America/New_York')}`,
        ],
      ],
      [
        'disabled',
        'La vérification en deux étapes est désactivée',
        ['Votre compte n’est protégé que par un mot de passe.'],
      ],
      [
        'authenticator-app-replaced',
        'Votre application d’authentification a été remplacée',
        ['les codes de l’ancienne ne sont plus acceptés'],
      ],
      [
        'backup-codes-regenerated',
        'Vos codes de secours ont été renouvelés',
        ['Codes de secours : 10 codes inutilisés sur 10'],
      ],
      [
        'security-key-added',
        'Une clé de sécurité a été ajoutée à votre compte',
        [`La clé de sécurité ${keyName} vient d’être ajoutée à votre compte`],
      ],
      [
        'security-key-removed',
        'Une clé de sécurité a été retirée de votre compte',
        [`La clé de sécurité ${keyName} vient d’être retirée de votre compte`],
      ],
    ])(
      'e-mails the change %s published as identity, with its subject and content',
      async (change, subject, lines) => {
        const event = change === 'enabled' ? enabled : twoStepChanged(change);

        publishAsIdentity('user.two-step-verification-changed.v1', event, event.id);

        const { message, headers, copies } = await emailOf(event.id);
        expect(copies).toBe(1);
        expect(message.Subject).toBe(subject);
        expect(message.To).toEqual([{ Name: camilleMartin.name, Address: camilleMartin.email }]);
        for (const line of lines) {
          expect(message.Text).toContain(line);
        }
        expect(message.Text).toContain('Appareil : Firefox sur Windows');
        expect(message.Text).toContain('Adresse IP : 192.0.2.14');
        expect(message.Text).toContain(
          'Gérer la vérification en deux étapes : http://app.cadenway.localhost/account/security',
        );
        expect(message.HTML).toContain('Sécurité · toujours envoyé');
        if (change.startsWith('security-key-')) {
          expect(message.HTML).toContain('<strong>Clé d’Hugo &amp; Camille</strong>');
          keyDeliveryIds.push((await deliveriesOf(event.id))[0]?.id ?? '');
        }
        expect(headers).not.toHaveProperty('List-Unsubscribe');
        expect(headers).not.toHaveProperty('List-Unsubscribe-Post');
        expect((await deliveriesOf(event.id))[0]?.template).toBe(
          change === 'enabled' || change === 'disabled' ? `two-step-${change}` : change,
        );
      },
    );

    it('sends one e-mail when the same change is delivered again', async () => {
      const before = await messageCount();

      // A new Nats-Msg-Id, so the broker stores it again and the consumer receives it again.
      publishAsIdentity('user.two-step-verification-changed.v1', enabled, randomUUID());
      await waitUntilHandled('user.two-step-verification-changed.v1');

      expect(await messageCount()).toBe(before);
      expect(await deliveriesOf(enabled.id)).toHaveLength(1);
      expect((await emailOf(enabled.id)).copies).toBe(1);
    });

    it('sends nothing for a change it does not know, and records it skipped', async () => {
      const before = await messageCount();
      const unknown = twoStepChanged('admin-reset', { enabled: false, methods: [] });

      publishAsIdentity('user.two-step-verification-changed.v1', unknown, unknown.id);
      await waitUntilHandled('user.two-step-verification-changed.v1');

      expect(await deliveriesOf(unknown.id)).toEqual([
        {
          id: expect.any(String) as string,
          template: null,
          status: 'skipped',
          skip_reason: 'change-not-supported',
          sent: false,
          pending: false,
        },
      ]);
      expect(await messageCount()).toBe(before);
    });

    it('never writes the name of a key in a log line', () => {
      const written = lines.join('');

      // The capture holds the lines of the key changes.
      expect(keyDeliveryIds).toHaveLength(2);
      for (const deliveryId of keyDeliveryIds) {
        expect(written).toContain(deliveryId);
      }
      expect(written).not.toContain('Clé d’Hugo');
      expect(written).not.toContain(camilleMartin.email);
      expect(written).not.toContain('192.0.2.14');
    });

    it('reads the changes through its granted consumer only, on its own filter', () => {
      expect(
        natsAccepts(
          notification,
          '--inbox-prefix',
          '_INBOX.notification',
          'consumer',
          'add',
          'EVENTS',
          'notification-service__request-two-step-email',
          '--pull',
          '--filter',
          'evt.user.deleted.v1',
          '--deliver',
          'new',
          '--defaults',
        ),
      ).toBe(false);
    });
  });
});
