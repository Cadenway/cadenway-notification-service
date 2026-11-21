import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { json } from 'node:stream/consumers';
import { fileURLToPath } from 'node:url';

import {
  QUOTA_THRESHOLD_REACHED_V1,
  quotaThresholdReachedV1Schema,
  type QuotaThresholdReachedV1,
} from '@cadenway/contracts/events/billing-service';
import {
  NOTIFICATION_CREATED_V1,
  notificationCreatedV1Schema,
  notificationDeliveryAuthorizationRequestedV1Schema,
} from '@cadenway/contracts/events/notification-service';
import {
  taskAssignedV1Schema,
  taskNotificationDeliveryAuthorizedV1Schema,
  type TaskAssignedV1,
  type TaskNotificationDeliveryAuthorizedV1,
} from '@cadenway/contracts/events/task-service';
import { GetNotificationRecipientInternalResponse } from '@cadenway/contracts/validators/internal/identity-service';
import {
  ListInboxNotificationsInternalResponse,
  UpdateNotificationPreferencesInternalResponse,
} from '@cadenway/contracts/validators/internal/notification-service';
import {
  ListQuotaNotificationRecipientsInternalQueryParams,
  LookupQuotaNotificationRecipientsInternalBody,
} from '@cadenway/contracts/validators/internal/organization-service';
import {
  createApplication,
  InternalTokenSigner,
  InternalTokenVerifier,
  loadConfig,
  runWithOrganizationContext,
  type Ed25519PrivateJwk,
} from '@cadenway/nest-common';
import { SystemTransactionRunner, TenantTransactionRunner } from '@cadenway/nest-common/database';
import { JobsService } from '@cadenway/nest-jobs';
import type { NestExpressApplication } from '@nestjs/platform-express';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';

import { AppModule } from '../src/app.module.js';
import { appConfigSchema } from '../src/config/app-config.js';
import {
  PLAN_ACTIVITY_EMAIL_QUEUE,
  QUOTA_ALERT_QUEUE,
  SEND_ACTIVITY_EMAIL_QUEUE,
} from '../src/config/job-queues.js';
import { PlanActivityEmail } from '../src/modules/activity-digests/application/use-cases/commands/digest/plan-activity-email/plan-activity-email.use-case.js';
import { notificationIdentityTestKey } from './support/notification-identity-test-config.js';

const composeFile = fileURLToPath(new URL('../compose.dev.yaml', import.meta.url));
const project = `cadenway-notification-activity-test-${String(process.pid)}`;
const WEB_APP = 'https://activity.example.test';
const PRIVATE_TASK_NAME = 'Synthetic task title · never include in email';
const ASSIGNED = 'task.assigned.v1';
const DECISION = 'task.notification-delivery-authorized.v1';
const REQUEST = 'notification.delivery-authorization-requested.v1';
const QUOTA_RECIPIENTS = '/internal/v1/quota-notification-recipients';
const WAIT = { timeout: 25_000, interval: 200 };

const attemptRow = z.object({ id: z.uuid(), expires_at: z.date(), outcome: z.string() });
type Attempt = z.output<typeof attemptRow>;

const mailList = z.object({
  messages: z
    .array(z.object({ ID: z.string(), MessageID: z.string() }))
    .nullable()
    .transform((messages) => messages ?? []),
});
const mailDetail = z.object({
  Subject: z.string(),
  Text: z.string(),
  HTML: z.string(),
  To: z.array(z.object({ Address: z.email() })),
});

/** Uses ephemeral loopback ports and a separate project for the three integration dependencies. */
function compose(...args: readonly string[]): string {
  return execFileSync(
    'docker',
    ['compose', '--project-name', project, '--file', composeFile, ...args],
    {
      encoding: 'utf8',
      env: {
        ...process.env,
        COMPOSE_DISABLE_ENV_FILE: '1',
        DEV_POSTGRES_PORT: '0',
        DEV_NATS_PORT: '0',
        DEV_SMTP_PORT: '0',
        DEV_MAILPIT_PORT: '0',
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    },
  );
}

/** Resolves the disposable host port of a published dependency. */
function port(service: string, containerPort: string): string {
  const value = compose('port', service, containerPort).trim().split(':').at(-1);
  if (value === undefined || !/^[1-9][0-9]*$/u.test(value)) {
    throw new Error(`Compose did not publish ${service}:${containerPort}.`);
  }
  return value;
}

/** Publishes Task's synthetic facts and inspects the throwaway JetStream. */
function nats(...args: readonly string[]): string {
  return compose('exec', '-T', 'nats-streams', 'nats', '--timeout', '2s', ...args);
}

/** Gives each transport publication a fresh NATS id so application replay handling is exercised. */
function publish(event: typeof ASSIGNED, payload: TaskAssignedV1): void;
function publish(event: typeof DECISION, payload: TaskNotificationDeliveryAuthorizedV1): void;
function publish(event: typeof QUOTA_THRESHOLD_REACHED_V1, payload: QuotaThresholdReachedV1): void;
function publish(
  event: string,
  payload: TaskAssignedV1 | TaskNotificationDeliveryAuthorizedV1 | QuotaThresholdReachedV1,
): void {
  nats(
    'pub',
    '--jetstream',
    '--header',
    `Nats-Msg-Id:${randomUUID()}`,
    '--header',
    `Cadenway-Event-Name:${event}`,
    `evt.${event}`,
    JSON.stringify(payload),
  );
}

/** Waits for the exact handler to acknowledge the publications, including replays. */
async function waitUntilHandled(handler: string): Promise<void> {
  await vi.waitFor(() => {
    const offsets = z
      .object({ num_pending: z.number(), num_ack_pending: z.number() })
      .parse(
        JSON.parse(
          nats('consumer', 'info', 'EVENTS', `notification-service__${handler}`, '--json'),
        ),
      );
    expect(offsets).toEqual({ num_pending: 0, num_ack_pending: 0 });
  }, WAIT);
}

/** Supplies only the public verification material of an in-memory fixture key. */
function publicKeyOf({ kty, crv, kid, x }: Ed25519PrivateJwk) {
  return { kty, crv, kid, x };
}

/** Builds a contracted Task assignment without passing any actual task or account data. */
function assignment(
  recipient: string = randomUUID(),
  organization: string = randomUUID(),
  key = 'CAD-482',
): TaskAssignedV1 {
  return taskAssignedV1Schema.parse({
    id: randomUUID(),
    occurredAt: new Date().toISOString(),
    organizationId: organization,
    actor: { type: 'user', id: randomUUID() },
    version: 1,
    key,
    spaceId: randomUUID(),
    listId: randomUUID(),
    parentKey: null,
    name: PRIVATE_TASK_NAME,
    status: 'todo',
    cancelReason: null,
    priority: 'moyenne',
    assigneeId: recipient,
    assigneeIds: [recipient],
    dueDate: null,
    startDate: null,
    estimateMinutes: null,
    labels: [],
    completedAt: null,
  });
}

/** Permits exactly one live correlation without returning recipient, task, or resource content. */
function permit(source: TaskAssignedV1, attempt: Attempt): TaskNotificationDeliveryAuthorizedV1 {
  return taskNotificationDeliveryAuthorizedV1Schema.parse({
    id: randomUUID(),
    occurredAt: new Date().toISOString(),
    organizationId: source.organizationId,
    actor: { type: 'system', id: 'task-service' },
    version: 1,
    authorizationRequestId: attempt.id,
    decision: 'permit',
    validUntil: attempt.expires_at.toISOString(),
  });
}

describe('activity and quota email delivery', () => {
  const knownRecipients = new Map<string, string>();
  const identityReads: string[] = [];
  const logs: string[] = [];
  const quotaLookups: string[] = [];
  const quotaPages: (string | undefined)[] = [];
  let quotaRecipients:
    | {
        organizationId: string;
        emailOnly: string;
        inboxOnly: string;
        revoked: string;
        current: Set<string>;
      }
    | undefined;
  let notification: NestExpressApplication | undefined;
  let identity: ReturnType<typeof createServer> | undefined;
  let gatewaySigner: InternalTokenSigner;
  let mailpitUrl: string;
  let composeStarted = false;

  /** Returns the running app from the suite setup. */
  function app(): NestExpressApplication {
    if (notification === undefined) throw new Error('Notification did not start.');
    return notification;
  }

  /** Accepts only a signed, global Notification system lookup for a configured fixture account. */
  async function identityRequest(
    verifier: InternalTokenVerifier,
    incoming: IncomingMessage,
    response: ServerResponse,
  ): Promise<void> {
    response.setHeader('Cache-Control', 'no-store');
    const account = /^\/internal\/v1\/users\/([^/?]+)\/notification-recipient$/u.exec(
      incoming.url ?? '',
    )?.[1];
    const authorization = /^Bearer (\S+)$/u.exec(incoming.headers.authorization ?? '')?.[1];
    if (incoming.method !== 'GET' || account === undefined || authorization === undefined) {
      response.writeHead(403).end();
      return;
    }
    const principal = await verifier.verify(authorization);
    if (
      principal.issuer !== 'notification-service' ||
      principal.organizationId !== null ||
      principal.actor.type !== 'system' ||
      principal.actor.id !== null ||
      principal.role !== null ||
      principal.scopes.length !== 0
    ) {
      response.writeHead(403).end();
      return;
    }
    const email = knownRecipients.get(account);
    identityReads.push(account);
    if (email === undefined) {
      response.writeHead(404, { 'Content-Type': 'application/problem+json' }).end(
        JSON.stringify({
          type: 'about:blank',
          title: 'Not Found',
          status: 404,
          code: 'user.not-found',
        }),
      );
      return;
    }
    const profile = GetNotificationRecipientInternalResponse.parse({
      email,
      language: 'en-GB',
      timeZone: 'Europe/Paris',
      version: 3,
    });
    response.writeHead(200, { 'Content-Type': 'application/json' }).end(JSON.stringify(profile));
  }

  /** Models current membership with a revocation between discovery and the delivery check. */
  async function organizationRequest(
    verifier: InternalTokenVerifier,
    incoming: IncomingMessage,
    response: ServerResponse,
  ): Promise<void> {
    const authorization = /^Bearer (\S+)$/u.exec(incoming.headers.authorization ?? '')?.[1];
    const fixture = quotaRecipients;
    response.setHeader('Cache-Control', 'private, no-store');
    if (authorization === undefined || fixture === undefined) {
      response.writeHead(403).end();
      return;
    }
    const principal = await verifier.verify(authorization);
    if (
      principal.issuer !== 'notification-service' ||
      principal.organizationId !== fixture.organizationId ||
      principal.actor.type !== 'system' ||
      principal.actor.id !== 'notification-service' ||
      principal.role !== null ||
      principal.scopes.length !== 0
    ) {
      response.writeHead(403).end();
      return;
    }
    const url = new URL(incoming.url ?? '/', 'http://organization.test');
    if (incoming.method === 'GET' && url.pathname === QUOTA_RECIPIENTS) {
      const { cursor, limit } = ListQuotaNotificationRecipientsInternalQueryParams.parse(
        Object.fromEntries(url.searchParams),
      );
      if (limit !== 100) {
        response.writeHead(400).end();
        return;
      }
      quotaPages.push(cursor);
      const page =
        cursor === undefined
          ? { items: [fixture.revoked], nextCursor: 'fixture-next-page' }
          : { items: [fixture.emailOnly, fixture.inboxOnly], nextCursor: null };
      response.writeHead(200, { 'Content-Type': 'application/json' }).end(JSON.stringify(page));
      return;
    }
    if (incoming.method === 'POST' && url.pathname === `${QUOTA_RECIPIENTS}/lookup`) {
      const { userIds } = LookupQuotaNotificationRecipientsInternalBody.parse(await json(incoming));
      quotaLookups.push(...userIds);
      const items = userIds.filter((userId) => fixture.current.has(userId));
      response
        .writeHead(200, { 'Content-Type': 'application/json' })
        .end(JSON.stringify({ items }));
      return;
    }
    response.writeHead(403).end();
  }

  beforeAll(async () => {
    const notificationKey = notificationIdentityTestKey();
    const gatewayKey = notificationIdentityTestKey();
    gatewaySigner = await InternalTokenSigner.create({
      issuer: 'api-gateway',
      privateJwk: gatewayKey,
    });
    const verifier = await InternalTokenVerifier.create({
      audience: 'identity-service',
      trustedIssuers: { 'notification-service': [publicKeyOf(notificationKey)] },
    });
    const organizationVerifier = await InternalTokenVerifier.create({
      audience: 'organization-service',
      trustedIssuers: { 'notification-service': [publicKeyOf(notificationKey)] },
    });
    const endpoint = createServer((incoming, response) => {
      const result = incoming.url?.startsWith(QUOTA_RECIPIENTS)
        ? organizationRequest(organizationVerifier, incoming, response)
        : identityRequest(verifier, incoming, response);
      void result.catch(() => {
        response.writeHead(403).end();
      });
    });
    identity = endpoint;
    await new Promise<void>((resolve, reject) => {
      endpoint.once('error', reject);
      endpoint.listen(0, '127.0.0.1', resolve);
    });
    const identityAddress = endpoint.address();
    if (identityAddress === null || typeof identityAddress === 'string') {
      throw new Error('The synthetic Identity endpoint has no TCP address.');
    }

    composeStarted = true;
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
    const postgresPort = port('postgres', '5432');
    mailpitUrl = `http://127.0.0.1:${port('mailpit', '8025')}`;
    vi.stubEnv(
      'MIGRATION_DATABASE_URL',
      `postgres://notification_migrator:notification_migrator@127.0.0.1:${postgresPort}/notification`,
    );
    try {
      await import('../src/migrate.js');
    } finally {
      vi.unstubAllEnvs();
    }

    const config = loadConfig(appConfigSchema, {
      PORT: '3016',
      LOG_PRETTY: 'false',
      LOG_LEVEL: 'debug',
      DATABASE_URL: `postgres://notification_app:notification_app@127.0.0.1:${postgresPort}/notification`,
      NATS_URL: `nats://127.0.0.1:${port('nats', '4222')}`,
      NATS_USER: 'notification',
      NATS_PASSWORD: 'notification',
      INTERNAL_TOKEN_AUDIENCE: 'notification-service',
      INTERNAL_TOKEN_TRUSTED_ISSUERS: JSON.stringify({ 'api-gateway': [publicKeyOf(gatewayKey)] }),
      INTERNAL_TOKEN_PRIVATE_JWK: JSON.stringify(notificationKey),
      IDENTITY_SERVICE_URL: `http://127.0.0.1:${String(identityAddress.port)}`,
      ORGANIZATION_SERVICE_URL: `http://127.0.0.1:${String(identityAddress.port)}`,
      SMTP_HOST: '127.0.0.1',
      SMTP_PORT: port('mailpit', '1025'),
      MAIL_FROM: 'notice@example.test',
      WEB_APP_URL: WEB_APP,
    });
    notification = await createApplication(AppModule, {
      service: 'notification-service',
      config,
      provideConfig: true,
      internalToken: {
        verifier: {
          audience: config.INTERNAL_TOKEN_AUDIENCE,
          trustedIssuers: config.INTERNAL_TOKEN_TRUSTED_ISSUERS,
        },
      },
      logDestination: {
        write: (line: string) => {
          logs.push(line);
          return true;
        },
      },
    });
    await notification.init();
  });

  afterAll(async () => {
    try {
      await notification?.close();
    } finally {
      try {
        const endpoint = identity;
        if (endpoint?.listening === true) {
          await new Promise<void>((resolve, reject) => {
            endpoint.close((error) => {
              if (error === undefined) resolve();
              else reject(error);
            });
          });
        }
      } finally {
        if (composeStarted) compose('down', '--volumes', '--remove-orphans');
      }
    }
  });

  /** Sets the fixture account's real preferences through the signed internal HTTP route. */
  async function setPreferences(
    source: TaskAssignedV1,
    email: boolean,
    digest: 'each' | 'weekly' = 'each',
  ): Promise<void> {
    const token = await gatewaySigner.sign('notification-service', {
      actor: { type: 'user', id: source.assigneeId },
      organizationId: null,
    });
    const response = await request(app().getHttpServer())
      .patch('/internal/v1/me/notification-preferences')
      .set('Authorization', `Bearer ${token}`)
      .send({
        digest,
        doNotDisturb: true,
        channels: { assignment: { email, inApp: !email } },
      });
    expect(response.status).toBe(200);
    expect(UpdateNotificationPreferencesInternalResponse.parse(response.body)).toMatchObject({
      digest,
      doNotDisturb: true,
      channels: { assignment: { email, inApp: !email } },
    });
  }

  /** Reads tenant-scoped attempts and the actual outbox facts for this source event. */
  async function attempts(source: TaskAssignedV1) {
    const tenant = app().get(TenantTransactionRunner);
    return runWithOrganizationContext(
      {
        organizationId: source.organizationId,
        actor: { type: 'user', id: source.assigneeId },
        role: 'owner',
        scopes: [],
      },
      () =>
        tenant.run(async ({ client }) => {
          const inbox = await client.query(
            `select id, expires_at, outcome from inbox_delivery_authorization_attempts
           where organization_id = $1 and source_event_id = $2 and recipient_id = $3`,
            [source.organizationId, source.id, source.assigneeId],
          );
          const activity = await client.query(
            `select a.id, a.expires_at, a.outcome from activity_email_authorization_attempts a
           join activity_email_candidates c on c.organization_id = a.organization_id
             and c.id = a.candidate_id and c.recipient_id = a.recipient_id
           where a.organization_id = $1 and c.source_event_id = $2 and a.recipient_id = $3
           order by a.created_at`,
            [source.organizationId, source.id, source.assigneeId],
          );
          const outbox = await client.query(
            `select payload from outbox_events where organization_id = $1 and event_name = $2
             and payload->>'recipientId' = $3 and status = 'sent'`,
            [source.organizationId, REQUEST, source.assigneeId],
          );
          const inboxItems = await client.query(
            `select id from inbox_notifications where organization_id = $1 and source_event_id = $2
             and recipient_id = $3`,
            [source.organizationId, source.id, source.assigneeId],
          );
          const emailCandidates = await client.query(
            `select id from activity_email_candidates where organization_id = $1 and source_event_id = $2
             and recipient_id = $3`,
            [source.organizationId, source.id, source.assigneeId],
          );
          return {
            inbox: attemptRow.array().parse(inbox.rows),
            activity: attemptRow.array().parse(activity.rows),
            published: z
              .object({ payload: notificationDeliveryAuthorizationRequestedV1Schema })
              .array()
              .parse(outbox.rows),
            inboxCount: inboxItems.rows.length,
            emailCandidateCount: emailCandidates.rows.length,
          };
        }),
    );
  }

  /** Reads a response from the isolated Mailpit only. */
  async function mailpit(path: string): Promise<unknown> {
    const response = await fetch(`${mailpitUrl}${path}`, { signal: AbortSignal.timeout(3_000) });
    if (!response.ok)
      throw new Error(`Mailpit declined the fixture operation (${String(response.status)}).`);
    return response.json() as Promise<unknown>;
  }

  /** Returns the Message-ID backed by the durably completed email occurrence for this fact. */
  async function completedMessageId(source: TaskAssignedV1): Promise<string> {
    const system = app().get(SystemTransactionRunner);
    return vi.waitFor(async () => {
      const result = await system.run(({ client }) =>
        client.query(
          `select o.id, o.state from activity_email_occurrences o join activity_email_candidates c
           on c.occurrence_id = o.id and c.recipient_id = o.recipient_id
         where c.organization_id = $1 and c.source_event_id = $2 and c.recipient_id = $3`,
          [source.organizationId, source.id, source.assigneeId],
        ),
      );
      const rows = z
        .object({ id: z.uuid(), state: z.literal('completed') })
        .array()
        .parse(result.rows);
      const [row] = rows;
      expect(rows).toHaveLength(1);
      if (row === undefined) throw new Error('Missing completed activity occurrence.');
      return `activity-${row.id}@example.test`;
    }, WAIT);
  }

  it('authorizes the Inbox and email separately and sends one redacted activity notice across replay', async () => {
    const source = assignment();
    const recipient = 'activity-enabled@example.test';
    knownRecipients.set(source.assigneeId, recipient);
    await setPreferences(source, true);
    publish(ASSIGNED, source);

    const pending = await vi.waitFor(async () => {
      const result = await attempts(source);
      expect(result.inbox).toHaveLength(1);
      expect(result.activity).toHaveLength(1);
      expect(result.published).toHaveLength(2);
      return result;
    }, WAIT);
    const inbox = pending.inbox[0];
    const activity = pending.activity[0];
    if (inbox === undefined || activity === undefined)
      throw new Error('Missing authorization attempt.');
    expect(inbox.id).not.toBe(activity.id);
    expect(pending.published.map(({ payload }) => payload.authorizationRequestId).sort()).toEqual(
      [inbox.id, activity.id].sort(),
    );
    expect(JSON.stringify(pending.published)).not.toContain(PRIVATE_TASK_NAME);
    expect(JSON.stringify(pending.published)).not.toContain(recipient);

    const inboxDecision = permit(source, inbox);
    publish(DECISION, inboxDecision);
    await vi.waitFor(async () => {
      const result = await attempts(source);
      expect(result.inbox[0]?.outcome).toBe('permitted');
      expect(result.activity[0]?.outcome).toBe('pending');
      expect(result.inboxCount).toBe(0);
    }, WAIT);
    expect(mailList.parse(await mailpit('/api/v1/messages')).messages).toEqual([]);

    const activityDecision = permit(source, activity);
    publish(DECISION, activityDecision);
    const summary = await vi.waitFor(async () => {
      const items = mailList.parse(await mailpit('/api/v1/messages')).messages;
      expect(items).toHaveLength(1);
      return items[0];
    }, WAIT);
    if (summary === undefined) throw new Error('Mailpit did not receive the activity notice.');
    const email = mailDetail.parse(await mailpit(`/api/v1/message/${summary.ID}`));
    expect(email.Subject).toBe('Your Cadenway activity');
    expect(email.To).toEqual([{ Address: recipient }]);
    expect(email.Text).toContain('1 new activity');
    expect(email.Text).toContain(`${WEB_APP}/account/notifications`);
    expect(email.HTML).toContain(`${WEB_APP}/account/notifications`);
    const headers = await mailpit(`/api/v1/message/${summary.ID}/headers`);
    expect(headers).not.toHaveProperty('List-Unsubscribe-Post');
    const content = email.Subject + email.Text + email.HTML;
    for (const value of [PRIVATE_TASK_NAME, source.key, source.listId, source.spaceId]) {
      expect(content).not.toContain(value);
    }

    expect(summary.MessageID).toBe(await completedMessageId(source));

    publish(ASSIGNED, source);
    publish(DECISION, inboxDecision);
    publish(DECISION, activityDecision);
    await waitUntilHandled('inbox-task-assigned');
    await waitUntilHandled('inbox-task-delivery-authorized');
    await waitUntilHandled('activity-task-delivery-authorized');
    const replayed = await attempts(source);
    expect(replayed).toMatchObject({
      inbox: [{ id: inbox.id, outcome: 'permitted' }],
      activity: [{ id: activity.id, outcome: 'permitted' }],
      inboxCount: 0,
    });
    expect(replayed.published.map(({ payload }) => payload.authorizationRequestId).sort()).toEqual(
      [inbox.id, activity.id].sort(),
    );
    expect(mailList.parse(await mailpit('/api/v1/messages')).messages).toEqual([summary]);
    expect(identityReads.filter((id) => id === source.assigneeId).length).toBeGreaterThanOrEqual(2);
    expect(logs.join('\n')).not.toContain(recipient);
    expect(logs.join('\n')).not.toContain(PRIVATE_TASK_NAME);
  }, 100_000);

  it('delivers to Inbox while email is off and mails only a new fact after reactivation', async () => {
    const source = assignment();
    knownRecipients.set(source.assigneeId, 'inbox-only@example.test');
    const prior = mailList.parse(await mailpit('/api/v1/messages')).messages;
    await setPreferences(source, false);
    publish(ASSIGNED, source);
    const pending = await vi.waitFor(async () => {
      const result = await attempts(source);
      expect(result.inbox).toHaveLength(1);
      expect(result.published).toHaveLength(1);
      return result.inbox[0];
    }, WAIT);
    if (pending === undefined) throw new Error('Missing Inbox authorization attempt.');
    publish(DECISION, permit(source, pending));

    const system = app().get(SystemTransactionRunner);
    await vi.waitFor(async () => {
      expect(await attempts(source)).toMatchObject({
        inboxCount: 1,
        activity: [],
        emailCandidateCount: 0,
      });
    }, WAIT);
    await waitUntilHandled('inbox-task-assigned');
    const plan = await system.run(({ client }) =>
      client.query(
        `select state from pgboss.job where name = $1 and data -> 'payload' ->> 'userId' = $2`,
        [PLAN_ACTIVITY_EMAIL_QUEUE, source.assigneeId],
      ),
    );
    expect(plan.rows).toEqual([]);
    expect(identityReads).not.toContain(source.assigneeId);
    expect((await attempts(source)).published).toHaveLength(1);
    expect(mailList.parse(await mailpit('/api/v1/messages')).messages).toEqual(prior);

    await setPreferences(source, true);
    const newSource = assignment(source.assigneeId, source.organizationId, 'CAD-483');
    publish(ASSIGNED, newSource);
    const next = await vi.waitFor(async () => {
      const result = await attempts(newSource);
      expect(result.inbox).toHaveLength(1);
      expect(result.activity).toHaveLength(1);
      expect(result.published).toHaveLength(3);
      return result;
    }, WAIT);
    const [nextInbox] = next.inbox;
    const [nextActivity] = next.activity;
    if (nextInbox === undefined || nextActivity === undefined) {
      throw new Error('Missing authorization after reactivating email.');
    }
    publish(DECISION, permit(newSource, nextInbox));
    publish(DECISION, permit(newSource, nextActivity));
    const messageId = await completedMessageId(newSource);
    const messages = mailList.parse(await mailpit('/api/v1/messages')).messages;
    expect(messages).toHaveLength(prior.length + 1);
    expect(messages.map((message) => message.MessageID)).toContain(messageId);
    expect(await attempts(source)).toMatchObject({
      inboxCount: 1,
      activity: [],
      emailCandidateCount: 0,
    });
  }, 100_000);

  it('reserves one weekly slot and persists a single deferred continuation for overflow', async () => {
    const source = assignment();
    knownRecipients.set(source.assigneeId, 'weekly@example.test');
    await setPreferences(source, true, 'weekly');
    const system = app().get(SystemTransactionRunner);
    await system.run(async ({ client }) => {
      await client.query(
        `insert into activity_email_candidates (organization_id, source_event_id, recipient_id, kind, task_key)
         select $1, gen_random_uuid(), $2, 'assignment', $3 from generate_series(1, 101)`,
        [source.organizationId, source.assigneeId, source.key],
      );
    });
    const plan = app().get(PlanActivityEmail);
    const notBeforeMs = Date.now() + 8 * 86_400_000;
    const input = { userId: source.assigneeId, notBeforeMs };
    const passes = await Promise.all([plan.execute(input), plan.execute(input)]);
    expect(passes.sort()).toEqual([0, 1]);

    const state = () =>
      system.run(async ({ client }) => {
        const slots = await client.query(
          `select occurrence.due_at, count(candidate.id)::int as assigned
             from activity_email_occurrences occurrence
             join activity_email_candidates candidate on candidate.occurrence_id = occurrence.id
            where occurrence.recipient_id = $1
            group by occurrence.id order by occurrence.due_at`,
          [source.assigneeId],
        );
        const jobs = await client.query(
          `select name, start_after from pgboss.job
            where data -> 'payload' ->> 'userId' = $1 order by start_after`,
          [source.assigneeId],
        );
        return {
          slots: z.object({ due_at: z.date(), assigned: z.number() }).array().parse(slots.rows),
          jobs: z.object({ name: z.string(), start_after: z.date() }).array().parse(jobs.rows),
        };
      });

    const first = await state();
    expect(first.slots).toHaveLength(1);
    const [slot] = first.slots;
    if (slot === undefined) throw new Error('Missing first weekly digest slot.');
    expect(slot.assigned).toBe(100);
    const cutoff = slot.due_at.getTime() + 1;
    expect(first.jobs).toEqual([
      { name: SEND_ACTIVITY_EMAIL_QUEUE, start_after: slot.due_at },
      { name: PLAN_ACTIVITY_EMAIL_QUEUE, start_after: new Date(cutoff) },
    ]);

    await expect(plan.execute({ ...input, notBeforeMs: cutoff })).resolves.toBe(1);
    const next = await state();
    expect(next.slots.map(({ assigned }) => assigned)).toEqual([100, 1]);
    expect(next.jobs.map(({ name }) => name)).toEqual([
      SEND_ACTIVITY_EMAIL_QUEUE,
      PLAN_ACTIVITY_EMAIL_QUEUE,
      SEND_ACTIVITY_EMAIL_QUEUE,
    ]);
  });

  it('delivers one quota email through Mailpit and one neutral Inbox receipt across channel preferences and replay', async () => {
    const organizationId = randomUUID();
    const emailOnly = randomUUID();
    const inboxOnly = randomUUID();
    const revoked = randomUUID();
    const recipient = 'current-quota-owner@example.test';
    const removedRecipient = 'removed-quota-owner@example.test';
    const current = new Set([emailOnly, inboxOnly]);
    quotaRecipients = { organizationId, emailOnly, inboxOnly, revoked, current };
    knownRecipients.set(emailOnly, recipient);
    knownRecipients.set(revoked, removedRecipient);
    for (const [id, email] of [
      [emailOnly, true],
      [inboxOnly, false],
    ] as const) {
      const token = await gatewaySigner.sign('notification-service', {
        actor: { type: 'user', id },
        organizationId: null,
      });
      const response = await request(app().getHttpServer())
        .patch('/internal/v1/me/notification-preferences')
        .set('Authorization', `Bearer ${token}`)
        .send({ channels: { billing: { email, inApp: !email } } });
      expect(response.status).toBe(200);
    }
    const threshold = quotaThresholdReachedV1Schema.parse({
      id: randomUUID(),
      occurredAt: new Date().toISOString(),
      organizationId,
      actor: { type: 'system', id: 'billing-service' },
      version: 1,
      metric: 'seats',
      thresholdPercent: 80,
      used: 4,
      limit: 5,
    });

    publish(QUOTA_THRESHOLD_REACHED_V1, threshold);
    publish(QUOTA_THRESHOLD_REACHED_V1, threshold);
    await waitUntilHandled('notify-quota-threshold');
    const system = app().get(SystemTransactionRunner);
    await vi.waitFor(async () => {
      const result = await system.run(({ client }) =>
        client.query(
          `select state from pgboss.job
           where name = $1 and (
             data -> 'payload' -> 'alert' ->> 'eventId' = $2 or
             data -> 'payload' ->> 'sourceEventId' = $2
           )`,
          [QUOTA_ALERT_QUEUE, threshold.id],
        ),
      );
      expect(result.rows).toEqual(Array.from({ length: 8 }, () => ({ state: 'completed' })));
    }, WAIT);
    expect(quotaPages).toEqual([undefined, 'fixture-next-page']);
    expect(quotaLookups.toSorted()).toEqual(
      [emailOnly, emailOnly, inboxOnly, revoked, revoked].sort(),
    );
    expect(identityReads).not.toContain(inboxOnly);

    // A distinct job for the same source is equivalent to an Inbox retry after commit.
    const replay = await runWithOrganizationContext(
      { organizationId, actor: { type: 'system', id: null }, role: null, scopes: [] },
      () =>
        app()
          .get(TenantTransactionRunner)
          .run((scope) =>
            app().get(JobsService).enqueue(scope, QUOTA_ALERT_QUEUE, {
              kind: 'in-app',
              userId: inboxOnly,
              sourceEventId: threshold.id,
            }),
          ),
    );
    await vi.waitFor(async () => {
      const jobs = await system.run(({ client }) =>
        client.query('select state from pgboss.job where name = $1 and id = $2', [
          QUOTA_ALERT_QUEUE,
          replay.jobId,
        ]),
      );
      expect(jobs.rows).toEqual([{ state: 'completed' }]);
    }, WAIT);
    expect(quotaLookups.filter((id) => id === inboxOnly)).toHaveLength(2);
    await vi.waitFor(async () => {
      const effects = await system.run(async ({ client }) => {
        const stored = await client.query(
          `select id, recipient_id, kind, actor_user_id, subject_kind, subject_value, comment_id, status
           from inbox_notifications where organization_id = $1 and source_event_id = $2`,
          [organizationId, threshold.id],
        );
        const facts = await client.query(
          `select payload from outbox_events where organization_id = $1 and event_name = $2 and status = 'sent'`,
          [organizationId, NOTIFICATION_CREATED_V1],
        );
        return { stored: stored.rows, facts: facts.rows };
      });
      const receipts = z.object({ id: z.uuid() }).array().parse(effects.stored);
      const [receipt] = receipts;
      expect(effects.stored).toEqual([
        {
          id: receipt?.id,
          recipient_id: inboxOnly,
          kind: 'billing',
          actor_user_id: null,
          subject_kind: null,
          subject_value: null,
          comment_id: null,
          status: null,
        },
      ]);
      const facts = z.object({ payload: notificationCreatedV1Schema }).array().parse(effects.facts);
      expect(facts).toHaveLength(1);
      expect(facts[0]?.payload).toMatchObject({
        notificationId: receipt?.id,
        recipientId: inboxOnly,
        subject: null,
      });
    }, WAIT);

    current.delete(inboxOnly);
    const memberToken = await gatewaySigner.sign('notification-service', {
      actor: { type: 'user', id: inboxOnly },
      organizationId,
      role: 'member',
    });
    const retainedReceipt = await request(app().getHttpServer())
      .get('/internal/v1/inbox/notifications')
      .set('Authorization', `Bearer ${memberToken}`);
    expect(retainedReceipt.status).toBe(200);
    const page = ListInboxNotificationsInternalResponse.parse(retainedReceipt.body);
    expect(page.items).toHaveLength(1);
    expect(page.items[0]?.record).toMatchObject({
      kind: 'billing',
      actorUserId: null,
      subject: null,
    });

    const messages = mailList.parse(await mailpit('/api/v1/messages')).messages;
    const quota = messages.filter(({ MessageID }) => MessageID.startsWith('quota-'));
    expect(quota).toHaveLength(1);
    const [summary] = quota;
    if (summary === undefined) throw new Error('Mailpit did not receive the quota email.');
    const message = mailDetail.parse(await mailpit(`/api/v1/message/${summary.ID}`));
    expect(message.Subject).toBe('Limite de sièges proche');
    expect(message.Text).toContain('4 sur 5 sièges');
    expect(message.HTML).toContain(`${WEB_APP}/org/quotas`);
    expect(message.To).toEqual([{ Address: recipient }]);
    expect(logs.join('\n')).not.toContain(recipient);
    expect(logs.join('\n')).not.toContain(removedRecipient);
  }, 100_000);
});
