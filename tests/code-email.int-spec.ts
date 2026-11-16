import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { createServer } from 'node:net';
import { fileURLToPath } from 'node:url';
import { eventSchemas } from '@cadenway/contracts/events/identity-service';
import type { OneTimeCodeIssuedV1 } from '@cadenway/contracts/events/identity-service';
import { createApplication, loadConfig, runWithOrganizationContext } from '@cadenway/nest-common';
import { SystemTransactionRunner, TenantTransactionRunner } from '@cadenway/nest-common/database';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { AppModule } from '../src/app.module.js';
import { appConfigSchema } from '../src/config/app-config.js';
import { ExpireCodeEmails } from '../src/modules/email/application/use-cases/commands/code-email/expire-code-emails/expire-code-emails.use-case.js';
import { CODE_EMAIL_DELIVERIES } from '../src/modules/email/composition/tokens/code-email/code-email-deliveries.token.js';
import type { CodeEmailDeliveries } from '../src/modules/email/application/ports/outbound/persistence/code-email/code-email-deliveries.port.js';
import { CODE_EMAIL_QUEUE } from '../src/modules/email/composition/tokens/code-email/code-email-queue.token.js';
import type { CodeEmailQueue } from '../src/modules/email/application/ports/outbound/jobs/code-email/code-email-queue.port.js';
import { CodeValidity } from '../src/modules/email/domain/value-objects/code-email/code-validity.value-object.js';
import { OneTimeCode } from '../src/modules/email/domain/value-objects/code-email/one-time-code.value-object.js';

// The code e-mails end to end, on the dependencies of compose.dev.yaml started as a throwaway
// Compose project on free ports: PostgreSQL with the two roles of cadenway-ops, NATS with the
// authorization of cadenway-ops (`identity` publishes the restricted events, `notification` alone
// reads them) and its three streams, and a disposable Mailpit that catches the e-mails and shows
// them on its HTTP API. The service runs as main.ts assembles it, as `notification_app` and the
// NATS user `notification`. A test never reaches the network: SMTP and HTTP stay on the loopback.

/** Compose file of the development dependencies. */
const composeFile: string = fileURLToPath(new URL('../compose.dev.yaml', import.meta.url));

/** Throwaway project name, apart from the dev stack and from the other integration specs. */
const project = `cadenway-notification-service-email-test-${String(process.pid)}`;

/** Durable consumer of the handler, as the kit names it. */
const consumer = 'notification-service__request-code-email';

/** The NATS user of identity-service, the publisher of the restricted events. */
const identity = { NATS_USER: 'identity', NATS_PASSWORD: 'identity' } as const;

/** Camille Martin (CM), the member of Atelier Nord the mockup signs in as. */
const camilleMartin = {
  id: '01938f6e-8a42-7d5b-b2c9-5e1f3a6d9c24',
  email: 'camille.martin@ateliernord.fr',
  name: 'Camille Martin',
} as const;

/** Atelier Nord, the organization of the mockup. */
const atelierNordId = '01938f6e-6d1a-7c3e-9a51-2f0c4b8d7e10';

/** Every code the specs issue: none of them may appear in a log line. */
const codes = {
  signUp: '482913',
  signIn: '739104',
  expired: '615320',
  emailChange: '208457',
  rolledBack: '530218',
  swept: '530219',
} as const;

/** Host port of NATS, fixed for the run like in tests/service-wiring.int-spec.ts. */
let natsHostPort = '0';

/** Base URL of the HTTP API of Mailpit. */
let mailpitUrl = '';

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
 * A `one-time-code.issued.v1` event for Camille Martin, issued now and valid 10 minutes (15 for
 * an address change), checked against the schema of the contract.
 *
 * @param purpose - What the code proves.
 * @param code - The 6 digits.
 * @param overrides - Fields to change.
 * @returns The payload, as identity-service publishes it.
 */
function codeIssued(
  purpose: 'email-verification' | 'sign-in' | 'email-change',
  code: string,
  overrides: Partial<OneTimeCodeIssuedV1> = {},
): OneTimeCodeIssuedV1 {
  const now = Date.now();
  return eventSchemas['one-time-code.issued.v1'].parse({
    id: randomUUID(),
    occurredAt: new Date(now).toISOString(),
    organizationId: null,
    actor: { type: 'system', id: 'identity-service' },
    version: 1,
    codeId: randomUUID(),
    userId: camilleMartin.id,
    purpose,
    code,
    expiresAt: new Date(now + (purpose === 'email-change' ? 15 : 10) * 60_000).toISOString(),
    recipient: { email: camilleMartin.email, name: camilleMartin.name },
    language: 'fr',
    ...overrides,
  });
}

/**
 * Publishes a restricted event as identity-service does: as the `identity` user, on
 * `restricted.one-time-code.issued.v1`, into `EVENTS_RESTRICTED`.
 *
 * @param event - The payload.
 * @param messageId - `Nats-Msg-Id`; the event id unless a redelivery is simulated.
 */
function publishAsIdentity(event: OneTimeCodeIssuedV1, messageId: string): void {
  nats(
    identity,
    '--inbox-prefix',
    '_INBOX.identity',
    'pub',
    '--jetstream',
    '--header',
    `Nats-Msg-Id:${messageId}`,
    '--header',
    'Cadenway-Event-Name:one-time-code.issued.v1',
    'restricted.one-time-code.issued.v1',
    JSON.stringify(event),
  );
}

/**
 * Waits until the consumer of the handler has acknowledged every message of its stream.
 */
async function waitUntilHandled(): Promise<void> {
  await vi.waitFor(
    () => {
      const info = JSON.parse(
        nats(null, 'consumer', 'info', 'EVENTS_RESTRICTED', consumer, '--json'),
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

describe('code e-mails', () => {
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
          `select d.id, d.status, d.skip_reason, d.sent_at is not null as sent,
                  exists (select 1 from pending_code_emails p where p.delivery_id = d.id) as pending
             from code_email_deliveries d
            where d.event_id = $1`,
          [eventId],
        );
        return result.rows as {
          readonly id: string;
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

    vi.stubEnv(
      'MIGRATION_DATABASE_URL',
      `postgres://notification_migrator:notification_migrator@127.0.0.1:${postgresPort}/notification`,
    );
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
    vi.stubEnv(
      'INTERNAL_TOKEN_TRUSTED_ISSUERS',
      '{"api-gateway":[{"kty":"OKP","crv":"Ed25519","x":"MVZQc5h6AXxnMpaBTaYw5kI-yWWawl6zp8Srhuf5NK0","kid":"local-placeholder"}]}',
    );
    vi.stubEnv('SMTP_HOST', '127.0.0.1');
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
      // Every line the service writes, at debug level, for the check that no code leaks.
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

  /** The sign-up event of the first spec, delivered again by a later one. */
  const signUp = codeIssued('email-verification', codes.signUp);

  it('receives a restricted event published as identity and e-mails the code through Mailpit', async () => {
    publishAsIdentity(signUp, signUp.id);

    const [summary] = await waitForMessages(1);
    if (summary === undefined) {
      throw new Error('Mailpit holds no message.');
    }
    const message = await mailpit<MailpitMessage>(`/api/v1/message/${summary.ID}`);
    const headers = await mailpit<Readonly<Record<string, readonly string[]>>>(
      `/api/v1/message/${summary.ID}/headers`,
    );

    expect(message.Subject).toBe('Confirmez votre adresse pour activer votre compte');
    expect(message.From).toEqual({ Name: 'Cadenway', Address: 'no-reply@cadenway.localhost' });
    expect(message.To).toEqual([{ Name: camilleMartin.name, Address: camilleMartin.email }]);
    // SMTP ends the lines of the text part with CRLF.
    expect(message.Text).toMatch(/^ {4}482 913\r?$/mu);
    expect(message.Text).toContain('Bonjour Camille Martin, votre compte a été créé.');
    expect(message.HTML).toContain('482 913');
    expect(headers['List-Unsubscribe']).toEqual([
      '<http://app.cadenway.localhost/account/notifications>',
    ]);
    expect(headers).not.toHaveProperty('List-Unsubscribe-Post');

    await waitUntilSettled(signUp.id);
    const deliveries = await deliveriesOf(signUp.id);
    expect(deliveries).toEqual([
      {
        id: expect.any(String) as string,
        status: 'sent',
        skip_reason: null,
        sent: true,
        pending: false,
      },
    ]);
    expect(message.MessageID).toBe(`${deliveries[0]?.id ?? ''}@cadenway.localhost`);
  });

  it('sends a sign-in code with the "Code de connexion" e-mail', async () => {
    const signIn = codeIssued('sign-in', codes.signIn);

    publishAsIdentity(signIn, signIn.id);

    const [latest] = await waitForMessages(2);
    expect(latest?.Subject).toBe('739 104 est votre code de connexion Cadenway');
    const message = await mailpit<MailpitMessage>(`/api/v1/message/${latest?.ID ?? ''}`);
    expect(message.Text).toContain(
      'Saisissez ce code sur la page de connexion pour accéder à Cadenway.',
    );
    expect(message.Text).toContain('http://app.cadenway.localhost/login/code');
  });

  it('sends one e-mail when the same event is delivered again', async () => {
    // A new Nats-Msg-Id, so the broker stores it again and the consumer receives it again.
    publishAsIdentity(signUp, randomUUID());
    await waitUntilHandled();

    expect(await waitForMessages(2)).toHaveLength(2);
    expect(await deliveriesOf(signUp.id)).toHaveLength(1);
  });

  it('does not send a code that expired before it arrived', async () => {
    const issuedAt = Date.now() - 15 * 60_000;
    const expired = codeIssued('sign-in', codes.expired, {
      occurredAt: new Date(issuedAt).toISOString(),
      expiresAt: new Date(issuedAt + 10 * 60_000).toISOString(),
    });

    publishAsIdentity(expired, expired.id);
    await waitUntilHandled();

    expect(await waitForMessages(2)).toHaveLength(2);
    expect(await deliveriesOf(expired.id)).toEqual([
      {
        id: expect.any(String) as string,
        status: 'skipped',
        skip_reason: 'expired',
        sent: false,
        pending: false,
      },
    ]);
  });

  it('does not send an address-change code yet', async () => {
    const change = codeIssued('email-change', codes.emailChange, {
      actor: { type: 'user', id: camilleMartin.id },
    });

    publishAsIdentity(change, change.id);
    await waitUntilHandled();

    expect(await waitForMessages(2)).toHaveLength(2);
    expect(await deliveriesOf(change.id)).toMatchObject([
      { status: 'skipped', skip_reason: 'purpose-not-supported', pending: false },
    ]);
  });

  it('leaves no delivery, content or job behind when the transaction that enqueued them rolls back', async () => {
    const system = service().get(SystemTransactionRunner);
    const deliveries = service().get<symbol, CodeEmailDeliveries>(CODE_EMAIL_DELIVERIES);
    const queue = service().get<symbol, CodeEmailQueue>(CODE_EMAIL_QUEUE);
    const eventId = randomUUID();
    let deliveryId = '';

    await expect(
      system.run(async () => {
        deliveryId =
          (await deliveries.record(
            {
              eventId,
              codeId: randomUUID(),
              userId: camilleMartin.id,
              purpose: 'sign-in',
              language: 'fr',
              validity: CodeValidity.between(new Date(), new Date(Date.now() + 10 * 60_000)),
              skipReason: null,
            },
            {
              code: OneTimeCode.of(codes.rolledBack),
              recipientEmail: camilleMartin.email,
              recipientName: camilleMartin.name,
            },
          )) ?? '';
        await queue.enqueue(deliveryId);
        throw new Error('rolled back after the enqueue');
      }),
    ).rejects.toThrow('rolled back after the enqueue');

    /**
     * Counts what remains of a delivery: its pending content and its jobs.
     *
     * @param id - Id of the delivery.
     * @returns The counts.
     */
    const remainsOf = async (
      id: string,
    ): Promise<{ readonly pending: number; readonly jobs: number }> =>
      system.run(async (tx) => {
        const result = await tx.client.query(
          `select (select count(*)::int from pending_code_emails where delivery_id = $1) as pending,
                  (select count(*)::int from pgboss.job
                    where name = 'email.send-code' and data -> 'payload' ->> 'deliveryId' = $1::text)
                    as jobs`,
          [id],
        );
        return result.rows[0] as { readonly pending: number; readonly jobs: number };
      });

    expect(deliveryId).not.toBe('');
    expect(await deliveriesOf(eventId)).toEqual([]);
    expect(await remainsOf(deliveryId)).toEqual({ pending: 0, jobs: 0 });
    // The same query finds the job of the e-mail sent by the first spec, kept an hour once done.
    const sent = (await deliveriesOf(signUp.id))[0]?.id ?? '';
    expect(await remainsOf(sent)).toEqual({ pending: 0, jobs: 1 });
  });

  it('settles with the sweep a queued e-mail whose code expired, and deletes its code and address', async () => {
    const system = service().get(SystemTransactionRunner);
    const deliveries = service().get<symbol, CodeEmailDeliveries>(CODE_EMAIL_DELIVERIES);
    const eventId = randomUUID();
    const issuedAt = Date.now() - 20 * 60_000;
    // Recorded as a job deleted before it started would leave it: queued, with its content.
    await system.run(() =>
      deliveries.record(
        {
          eventId,
          codeId: randomUUID(),
          userId: camilleMartin.id,
          purpose: 'sign-in',
          language: 'fr',
          validity: CodeValidity.between(new Date(issuedAt), new Date(issuedAt + 10 * 60_000)),
          skipReason: null,
        },
        {
          code: OneTimeCode.of(codes.swept),
          recipientEmail: camilleMartin.email,
          recipientName: camilleMartin.name,
        },
      ),
    );

    const result = await service().get(ExpireCodeEmails).execute();

    expect(result.expired).toBeGreaterThanOrEqual(1);
    expect(await deliveriesOf(eventId)).toMatchObject([
      { status: 'skipped', skip_reason: 'expired', pending: false },
    ]);
    const schedules = await system.run(async (tx) => {
      const rows = await tx.client.query(
        `select name, cron, timezone from pgboss.schedule where name = 'email.expire-codes'`,
      );
      return rows.rows as readonly Readonly<Record<string, string>>[];
    });
    expect(schedules).toEqual([
      { name: 'email.expire-codes', cron: '*/5 * * * *', timezone: 'UTC' },
    ]);
  });

  it('lets no other user read the restricted stream, not even its publisher', () => {
    const inbox = ['--inbox-prefix', '_INBOX.identity'];

    expect(natsAccepts(identity, 'sub', 'restricted.>', '--count', '1')).toBe(false);
    expect(
      natsAccepts(
        identity,
        ...inbox,
        'consumer',
        'add',
        'EVENTS_RESTRICTED',
        'identity__read-codes',
        '--pull',
        '--filter',
        'restricted.one-time-code.issued.v1',
        '--defaults',
      ),
    ).toBe(false);
    expect(natsAccepts(identity, ...inbox, 'stream', 'get', 'EVENTS_RESTRICTED', '1')).toBe(false);
    expect(
      natsAccepts(
        identity,
        ...inbox,
        'consumer',
        'next',
        'EVENTS_RESTRICTED',
        consumer,
        '--no-ack',
      ),
    ).toBe(false);
    expect(
      natsAccepts({ NATS_USER: '', NATS_PASSWORD: '' }, 'sub', 'restricted.>', '--count', '1'),
    ).toBe(false);
    // The reader of the stream may not publish into it: only identity-service issues codes.
    expect(
      natsAccepts(
        { NATS_USER: 'notification', NATS_PASSWORD: 'notification' },
        '--inbox-prefix',
        '_INBOX.notification',
        'pub',
        '--jetstream',
        'restricted.one-time-code.issued.v1',
        '{}',
      ),
    ).toBe(false);
  });

  it('keeps the send log and the pending codes out of every tenant transaction', async () => {
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
            `select (select count(*)::int from code_email_deliveries) as deliveries,
                    (select count(*)::int from pending_code_emails) as pending`,
          );
          return result.rows[0] as { readonly deliveries: number; readonly pending: number };
        }),
    );

    expect(visible).toEqual({ deliveries: 0, pending: 0 });
    expect((await deliveriesOf(signUp.id)).length).toBe(1);
  });

  it('never writes a code nor the address of the recipient in a log line', async () => {
    const deliveryId = (await deliveriesOf(signUp.id))[0]?.id ?? '';
    const written = lines.join('');

    // The capture holds the lines of the handled events.
    expect(written).toContain(deliveryId);
    for (const code of Object.values(codes)) {
      expect(written).not.toContain(code);
      expect(written).not.toContain(`${code.slice(0, 3)} ${code.slice(3)}`);
    }
    expect(written).not.toContain(camilleMartin.email);
  });
});
