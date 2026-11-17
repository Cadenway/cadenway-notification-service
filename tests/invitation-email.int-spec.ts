import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { createServer } from 'node:net';
import { fileURLToPath } from 'node:url';
import { eventSchemas } from '@cadenway/contracts/events/organization-service';
import type { InvitationIssuedV1 } from '@cadenway/contracts/events/organization-service';
import { createApplication, loadConfig, runWithOrganizationContext } from '@cadenway/nest-common';
import type { OrganizationContext } from '@cadenway/nest-common';
import { SystemTransactionRunner, TenantTransactionRunner } from '@cadenway/nest-common/database';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { AppModule } from '../src/app.module.js';
import { appConfigSchema } from '../src/config/app-config.js';
import type { InvitationEmailQueue } from '../src/modules/email/application/ports/outbound/jobs/invitation-email/invitation-email-queue.port.js';
import type { InvitationEmailDeliveries } from '../src/modules/email/application/ports/outbound/persistence/invitation-email/invitation-email-deliveries.port.js';
import { InvitationValidity } from '../src/modules/email/domain/value-objects/invitation-email/invitation-validity.value-object.js';
import { ExpireInvitationEmails } from '../src/modules/email/application/use-cases/commands/invitation-email/expire-invitation-emails/expire-invitation-emails.use-case.js';
import { INVITATION_EMAIL_DELIVERIES } from '../src/modules/email/composition/tokens/invitation-email/invitation-email-deliveries.token.js';
import { INVITATION_EMAIL_QUEUE } from '../src/modules/email/composition/tokens/invitation-email/invitation-email-queue.token.js';
import { frenchDate } from '../src/modules/email/infrastructure/adapters/templates/invitation-email-wording.js';

// The invitation e-mail end to end, on the dependencies of compose.dev.yaml started as a throwaway
// Compose project on free ports: PostgreSQL with the two roles of cadenway-ops, NATS with the
// authorization of cadenway-ops (`organization` publishes the invitations into EVENTS) and its
// three streams, and a disposable Mailpit that catches the e-mails and shows them on its HTTP API.
// The service runs as main.ts assembles it, as `notification_app` and the NATS user
// `notification`. A test never reaches the network: SMTP and HTTP stay on the loopback.

/** Compose file of the development dependencies. */
const composeFile: string = fileURLToPath(new URL('../compose.dev.yaml', import.meta.url));

/** Throwaway project name, apart from the dev stack and from the other integration specs. */
const project = `cadenway-notification-service-invitation-test-${String(process.pid)}`;

/** Durable consumer of the handler, as the kit names it. */
const consumer = 'notification-service__request-invitation-email';

/** The NATS user of organization-service, the publisher of the invitations. */
const organization = { NATS_USER: 'organization', NATS_PASSWORD: 'organization' } as const;

/** Atelier Nord, the organization of the mockup. */
const atelierNordId = '01938f6e-6d1a-7c3e-9a51-2f0c4b8d7e10';

/** Another organization, which must never see a row of Atelier Nord. */
const otherOrganizationId = '01938f6e-0000-7000-8000-000000000002';

/** Hugo Durand, the inviter of the "Invitation" e-mail of the mockup. */
const hugoDurand = { userId: '01938f6e-1111-7d5b-b2c9-5e1f3a6d9c24', name: 'Hugo Durand' } as const;

/** Every invited address: none of them may appear in a log line. */
const invitees = {
  marc: 'marc.roux@ateliernord.fr',
  lucie: 'lucie@exemple.fr',
  expired: 'ines.robert@exemple.fr',
  rolledBack: 'paul.girard@exemple.fr',
  swept: 'nina.leroy@exemple.fr',
} as const;

/** One week, in milliseconds: the validity of an invitation. */
const WEEK_MS = 7 * 86_400_000;

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
 * An `invitation.issued.v1` event of Atelier Nord, sent now by Hugo Durand and valid 7 days,
 * checked against the schema of the contract.
 *
 * @param email - The invited address.
 * @param overrides - Fields to change.
 * @returns The payload, as organization-service publishes it.
 */
function invitationIssued(
  email: string,
  overrides: Partial<InvitationIssuedV1> = {},
): InvitationIssuedV1 {
  const now = Date.now();
  return eventSchemas['invitation.issued.v1'].parse({
    id: randomUUID(),
    occurredAt: new Date(now).toISOString(),
    organizationId: atelierNordId,
    actor: { type: 'user', id: hugoDurand.userId },
    version: 1,
    invitationId: randomUUID(),
    email,
    role: 'member',
    inviter: hugoDurand,
    organization: { name: 'Atelier Nord', memberCount: 18 },
    expiresAt: new Date(now + WEEK_MS).toISOString(),
    language: 'fr',
    ...overrides,
  });
}

/**
 * Publishes an invitation as organization-service does: as the `organization` user, on
 * `evt.invitation.issued.v1`, into `EVENTS`.
 *
 * @param event - The payload.
 * @param messageId - `Nats-Msg-Id`; the event id unless a redelivery is simulated.
 */
function publishAsOrganization(event: InvitationIssuedV1, messageId: string): void {
  nats(
    organization,
    '--inbox-prefix',
    '_INBOX.organization',
    'pub',
    '--jetstream',
    '--header',
    `Nats-Msg-Id:${messageId}`,
    '--header',
    'Cadenway-Event-Name:invitation.issued.v1',
    '--header',
    `Cadenway-Organization-Id:${event.organizationId}`,
    'evt.invitation.issued.v1',
    JSON.stringify(event),
  );
}

/**
 * Waits until the consumer of the handler has acknowledged every message of its stream.
 */
async function waitUntilHandled(): Promise<void> {
  await vi.waitFor(
    () => {
      const info = JSON.parse(nats(null, 'consumer', 'info', 'EVENTS', consumer, '--json')) as {
        readonly num_pending: number;
        readonly num_ack_pending: number;
      };
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
 * The organization context of Atelier Nord, or of another organization, for the system.
 *
 * @param organizationId - The organization.
 * @returns The context.
 */
function contextOf(organizationId: string): OrganizationContext {
  return { organizationId, actor: { type: 'system', id: null }, role: null, scopes: [] };
}

/** A row of the send log with whether a pending content remains. */
interface DeliveryRow {
  readonly id: string;
  readonly organization_id: string;
  readonly invitation_version: number;
  readonly status: string;
  readonly skip_reason: string | null;
  readonly sent: boolean;
  readonly pending: boolean;
}

describe('invitation e-mails', () => {
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
   * Reads the send log of an invitation, as the system runner of the service sees it.
   *
   * @param column - `event_id` or `invitation_id`.
   * @param id - Its value.
   * @returns The deliveries, oldest version first.
   */
  async function deliveriesBy(
    column: 'event_id' | 'invitation_id',
    id: string,
  ): Promise<readonly DeliveryRow[]> {
    return service()
      .get(SystemTransactionRunner)
      .run(async (tx) => {
        const result = await tx.client.query(
          `select d.id, d.organization_id, d.invitation_version, d.status, d.skip_reason,
                  d.sent_at is not null as sent,
                  exists (select 1 from pending_invitation_emails p where p.delivery_id = d.id)
                    as pending
             from invitation_email_deliveries d
            where d.${column} = $1
            order by d.invitation_version, d.created_at`,
          [id],
        );
        return result.rows as DeliveryRow[];
      });
  }

  /**
   * Waits until the jobs of an invitation have settled its deliveries.
   *
   * @param invitationId - Id of the invitation.
   */
  async function waitUntilSettled(invitationId: string): Promise<void> {
    await vi.waitFor(
      async () => {
        const deliveries = await deliveriesBy('invitation_id', invitationId);
        expect(deliveries.length).toBeGreaterThan(0);
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
      // Every line the service writes, at debug level, for the check that no address leaks.
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

  /** The invitation of the first spec, delivered again and sent again by later ones. */
  const invitation = invitationIssued(invitees.marc);

  it('e-mails an invitation published to the stream through Mailpit, with the subject, the link and the text of the mockup', async () => {
    publishAsOrganization(invitation, invitation.id);

    const [summary] = await waitForMessages(1);
    if (summary === undefined) {
      throw new Error('Mailpit holds no message.');
    }
    const message = await mailpit<MailpitMessage>(`/api/v1/message/${summary.ID}`);
    const headers = await mailpit<Readonly<Record<string, readonly string[]>>>(
      `/api/v1/message/${summary.ID}/headers`,
    );
    const link = `http://app.cadenway.localhost/invite/${invitation.invitationId}`;
    const expiry = frenchDate(new Date(invitation.expiresAt));

    expect(message.Subject).toBe('Hugo Durand vous invite à rejoindre Atelier Nord');
    expect(message.From).toEqual({ Name: 'Cadenway', Address: 'no-reply@cadenway.localhost' });
    expect(message.To).toEqual([{ Name: '', Address: invitees.marc }]);
    // SMTP ends the lines of the text part with CRLF.
    const text = message.Text.replace(/\r\n/gu, '\n');
    expect(text).toContain('Atelier Nord · 18 membres\n');
    expect(text).toContain(
      'Hugo Durand vous invite à rejoindre l’organisation Atelier Nord sur Cadenway, avec le rôle Membre.\n',
    );
    expect(text).toContain(`Rejoindre Atelier Nord : ${link}\n`);
    expect(text).toContain(
      `L’invitation expire le ${expiry}. Vous ne connaissez pas Hugo ? Ignorez cet e-mail.\n`,
    );
    expect(text).toContain(
      'Vous recevez cet e-mail car un membre d’Atelier Nord a invité votre adresse.\n',
    );
    expect(message.HTML).toContain(`href="${link}"`);
    expect(message.HTML).toContain(`Rôle proposé : Membre. L’invitation expire le ${expiry}.`);
    expect(headers['List-Unsubscribe']).toEqual([
      '<http://app.cadenway.localhost/account/notifications>',
    ]);
    expect(headers['List-Unsubscribe-Post']).toEqual(['List-Unsubscribe=One-Click']);

    await waitUntilSettled(invitation.invitationId);
    const deliveries = await deliveriesBy('event_id', invitation.id);
    expect(deliveries).toEqual([
      {
        id: expect.any(String) as string,
        organization_id: atelierNordId,
        invitation_version: 1,
        status: 'sent',
        skip_reason: null,
        sent: true,
        pending: false,
      },
    ]);
    expect(message.MessageID).toBe(`${deliveries[0]?.id ?? ''}@cadenway.localhost`);
  });

  it('sends one e-mail when the same event is delivered again', async () => {
    // A new Nats-Msg-Id, so the broker stores it again and the consumer receives it again.
    publishAsOrganization(invitation, randomUUID());
    await waitUntilHandled();

    expect(await waitForMessages(1)).toHaveLength(1);
    expect(await deliveriesBy('event_id', invitation.id)).toHaveLength(1);
  });

  it('sends a second e-mail for a resend of the same invitation, a new event with the next version', async () => {
    const resend = invitationIssued(invitees.marc, {
      invitationId: invitation.invitationId,
      version: 2,
    });

    publishAsOrganization(resend, resend.id);

    const [latest] = await waitForMessages(2);
    expect(latest?.Subject).toBe('Hugo Durand vous invite à rejoindre Atelier Nord');
    await waitUntilSettled(invitation.invitationId);
    expect(
      (await deliveriesBy('invitation_id', invitation.invitationId)).map((delivery) => ({
        version: delivery.invitation_version,
        status: delivery.status,
      })),
    ).toEqual([
      { version: 1, status: 'sent' },
      { version: 2, status: 'sent' },
    ]);
  });

  it('sends nothing for a version older than one already received', async () => {
    const later = invitationIssued(invitees.lucie, { version: 2, role: 'guest' });
    const earlier = invitationIssued(invitees.lucie, {
      invitationId: later.invitationId,
      version: 1,
      role: 'guest',
    });

    publishAsOrganization(later, later.id);
    await waitForMessages(3);
    publishAsOrganization(earlier, earlier.id);
    await waitUntilHandled();

    expect(await waitForMessages(3)).toHaveLength(3);
    expect(await deliveriesBy('event_id', earlier.id)).toMatchObject([
      { status: 'skipped', skip_reason: 'superseded', pending: false },
    ]);
  });

  it('does not send an invitation that expired before it arrived', async () => {
    const sentAt = Date.now() - WEEK_MS - 60_000;
    const expired = invitationIssued(invitees.expired, {
      occurredAt: new Date(sentAt).toISOString(),
      expiresAt: new Date(sentAt + WEEK_MS).toISOString(),
    });

    publishAsOrganization(expired, expired.id);
    await waitUntilHandled();

    expect(await waitForMessages(3)).toHaveLength(3);
    expect(await deliveriesBy('event_id', expired.id)).toMatchObject([
      { status: 'skipped', skip_reason: 'expired', sent: false, pending: false },
    ]);
  });

  it('leaves no delivery, content or job behind when the transaction that enqueued them rolls back', async () => {
    const tenant = service().get(TenantTransactionRunner);
    const deliveries = service().get<symbol, InvitationEmailDeliveries>(
      INVITATION_EMAIL_DELIVERIES,
    );
    const queue = service().get<symbol, InvitationEmailQueue>(INVITATION_EMAIL_QUEUE);
    const eventId = randomUUID();
    let deliveryId = '';

    await expect(
      runWithOrganizationContext(contextOf(atelierNordId), () =>
        tenant.run(async () => {
          deliveryId =
            (await deliveries.record(
              {
                eventId,
                invitationId: randomUUID(),
                invitationVersion: 1,
                role: 'admin',
                language: 'fr',
                validity: InvitationValidity.between(new Date(), new Date(Date.now() + WEEK_MS)),
                skipReason: null,
              },
              {
                recipientEmail: invitees.rolledBack,
                inviterName: hugoDurand.name,
                organizationName: 'Atelier Nord',
                memberCount: 18,
              },
            )) ?? '';
          await queue.enqueue(deliveryId);
          throw new Error('rolled back after the enqueue');
        }),
      ),
    ).rejects.toThrow('rolled back after the enqueue');

    const remains = await service()
      .get(SystemTransactionRunner)
      .run(async (tx) => {
        const result = await tx.client.query(
          `select (select count(*)::int from pending_invitation_emails where delivery_id = $1)
                    as pending,
                  (select count(*)::int from pgboss.job
                    where name = 'email.send-invitation'
                      and data -> 'payload' ->> 'deliveryId' = $1::text) as jobs`,
          [deliveryId],
        );
        return result.rows[0] as { readonly pending: number; readonly jobs: number };
      });
    expect(deliveryId).not.toBe('');
    expect(await deliveriesBy('event_id', eventId)).toEqual([]);
    expect(remains).toEqual({ pending: 0, jobs: 0 });
  });

  it('settles with the hourly sweep a queued e-mail whose invitation expired, and deletes its address', async () => {
    const deliveries = service().get<symbol, InvitationEmailDeliveries>(
      INVITATION_EMAIL_DELIVERIES,
    );
    const eventId = randomUUID();
    const sentAt = Date.now() - WEEK_MS - 3_600_000;
    // Recorded as a last attempt that crashed would leave it: queued, with its content.
    await runWithOrganizationContext(contextOf(atelierNordId), () =>
      deliveries.record(
        {
          eventId,
          invitationId: randomUUID(),
          invitationVersion: 1,
          role: 'member',
          language: 'fr',
          validity: InvitationValidity.between(new Date(sentAt), new Date(sentAt + WEEK_MS)),
          skipReason: null,
        },
        {
          recipientEmail: invitees.swept,
          inviterName: hugoDurand.name,
          organizationName: 'Atelier Nord',
          memberCount: 18,
        },
      ),
    );

    const result = await service().get(ExpireInvitationEmails).execute();

    expect(result.expired).toBeGreaterThanOrEqual(1);
    expect(await deliveriesBy('event_id', eventId)).toMatchObject([
      { status: 'skipped', skip_reason: 'expired', pending: false },
    ]);
    const schedules = await service()
      .get(SystemTransactionRunner)
      .run(async (tx) => {
        const rows = await tx.client.query(
          `select name, cron, timezone from pgboss.schedule where name = 'email.expire-invitations'`,
        );
        return rows.rows as readonly Readonly<Record<string, string>>[];
      });
    expect(schedules).toEqual([
      { name: 'email.expire-invitations', cron: '0 * * * *', timezone: 'UTC' },
    ]);
  });

  it('keeps the invitation e-mails of Atelier Nord out of the tenant transactions of another organization', async () => {
    const tenant = service().get(TenantTransactionRunner);

    /**
     * Counts the rows an organization sees.
     *
     * @param organizationId - The organization.
     * @returns The deliveries and pending contents it sees.
     */
    const visibleTo = async (
      organizationId: string,
    ): Promise<{ readonly deliveries: number; readonly pending: number }> =>
      runWithOrganizationContext(contextOf(organizationId), () =>
        tenant.run(async (tx) => {
          const result = await tx.client.query(
            `select (select count(*)::int from invitation_email_deliveries) as deliveries,
                    (select count(*)::int from pending_invitation_emails) as pending`,
          );
          return result.rows[0] as { readonly deliveries: number; readonly pending: number };
        }),
      );

    expect(await visibleTo(otherOrganizationId)).toEqual({ deliveries: 0, pending: 0 });
    expect((await visibleTo(atelierNordId)).deliveries).toBeGreaterThanOrEqual(6);
  });

  it('never writes the address of an invitee nor the name of the inviter in a log line', async () => {
    const deliveryId = (await deliveriesBy('event_id', invitation.id))[0]?.id ?? '';
    const written = lines.join('');

    // The capture holds the lines of the handled events and jobs.
    expect(written).toContain(deliveryId);
    for (const address of Object.values(invitees)) {
      expect(written).not.toContain(address);
    }
    expect(written).not.toContain(hugoDurand.name);
  });
});
