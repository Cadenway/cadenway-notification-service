import { eventSchemas } from '@cadenway/contracts/events/identity-service';
import type {
  EventName,
  PasswordResetLinkIssuedV1,
  SessionOpenedOnNewDeviceV1,
  UserDeletionCancelledV1,
  UserDeletionScheduledV1,
  UserEmailChangedV1,
  UserPasswordChangedV1,
} from '@cadenway/contracts/events/identity-service';
import type { EventConsumers, EventContext } from '@cadenway/nest-messaging';
import { Logger } from '@nestjs/common';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  FixedClock,
  ImmediateUnitOfWork,
  RecordingEmailSender,
} from '../../../../application/ports/outbound/persistence/code-email/code-email-deliveries.port.fixture.js';
import {
  InMemorySecurityEmailDeliveries,
  InMemorySecurityEmailQueue,
} from '../../../../application/ports/outbound/persistence/security-email/security-email-deliveries.port.fixture.js';
import { RequestSecurityEmail } from '../../../../application/use-cases/commands/security-email/request-security-email/request-security-email.use-case.js';
import { SendSecurityEmail } from '../../../../application/use-cases/commands/security-email/send-security-email/send-security-email.use-case.js';
import { HandlebarsEmailRenderer } from '../../../../infrastructure/adapters/templates/handlebars-email-renderer.adapter.js';
import { AccountSecurityEventsHandler } from './account-security-events.handler.js';

/**
 * Interface RegisteredSubscription
 *
 * @description
 * A subscription the handler registers, as the kit receives it.
 */
interface RegisteredSubscription {
  // #region Properties
  /**
   * Property handler
   *
   * @description
   * Name of the handler, hence of the durable consumer.
   *
   * @type {string}
   * @readonly
   */
  readonly handler: string;

  /**
   * Property event
   *
   * @description
   * The event consumed.
   *
   * @type {EventName}
   * @readonly
   */
  readonly event: EventName;

  /**
   * Property deliverPolicy
   *
   * @description
   * Where a new consumer starts.
   *
   * @type {string}
   * @readonly
   */
  readonly deliverPolicy: string;

  /**
   * Property schemas
   *
   * @description
   * The schemas the kit validates the payload with.
   *
   * @type {unknown}
   * @readonly
   */
  readonly schemas: unknown;

  /**
   * Property handle
   *
   * @description
   * The function the kit calls with a validated payload.
   *
   * @type {(payload: never, context: EventContext) => Promise<void>}
   * @readonly
   */
  readonly handle: (payload: never, context: EventContext) => Promise<void>;
  // #endregion
}

/**
 * Constant context
 *
 * @description
 * The context the kit gives a first delivery; the handler does not read it.
 *
 * @type {EventContext}
 */
const context: EventContext = {
  deliveryCount: 1,
  streamSequence: 1,
  redelivered: false,
  claimVersion: () => Promise.resolve(true),
  signal: new AbortController().signal,
};

/**
 * Constant client
 *
 * @description
 * The browser of the examples of the contract.
 *
 * @type {UserPasswordChangedV1['client']}
 */
const client: UserPasswordChangedV1['client'] = {
  device: {
    type: 'desktop',
    browser: 'Firefox',
    browserVersion: '132',
    os: 'Windows',
    osVersion: null,
  },
  ipAddress: '192.0.2.14',
};

/**
 * Constant camilleMartin
 *
 * @description
 * The account of the examples: Camille Martin.
 *
 * @type {{ readonly userId: string; readonly email: string; readonly name: string }}
 */
const camilleMartin: { readonly userId: string; readonly email: string; readonly name: string } = {
  userId: '019a5f3c-8d2e-7c4a-9b1f-3e5d7a9c1b30',
  email: 'camille.martin@ateliernord.fr',
  name: 'Camille Martin',
};

/**
 * Constant common
 *
 * @description
 * The members every event of the examples shares, at 9 November 2026, 14:10 in Paris.
 *
 * @type {Readonly<Record<string, unknown>>}
 */
const common: Readonly<Record<string, unknown>> = {
  occurredAt: '2026-11-09T13:10:00.000Z',
  organizationId: null,
  actor: { type: 'user', id: camilleMartin.userId },
  userId: camilleMartin.userId,
  language: 'en',
  timeZone: 'Europe/Paris',
};

/**
 * Constant events
 *
 * @description
 * One event of each kind, valid against the schemas of the contract.
 *
 * @type {{ readonly reset: PasswordResetLinkIssuedV1; readonly changed: UserPasswordChangedV1; readonly emailChanged: UserEmailChangedV1; readonly newDevice: SessionOpenedOnNewDeviceV1; readonly scheduled: UserDeletionScheduledV1; readonly cancelled: UserDeletionCancelledV1 }}
 */
const events: {
  readonly reset: PasswordResetLinkIssuedV1;
  readonly changed: UserPasswordChangedV1;
  readonly emailChanged: UserEmailChangedV1;
  readonly newDevice: SessionOpenedOnNewDeviceV1;
  readonly scheduled: UserDeletionScheduledV1;
  readonly cancelled: UserDeletionCancelledV1;
} = {
  reset: eventSchemas['password-reset-link.issued.v1'].parse({
    ...common,
    id: '019a6b44-0a1b-7c2d-8e3f-4a5b6c7d8e06',
    actor: { type: 'system', id: 'identity-service' },
    version: 1,
    linkId: '019a6b44-0a1b-7c2d-8e3f-4a5b6c7d8e07',
    token: 'ExampleOnlyResetToken0000000000000000000000',
    expiresAt: '2026-11-09T13:40:00.000Z',
    client,
    recipient: { email: camilleMartin.email, name: camilleMartin.name },
  }),
  changed: eventSchemas['user.password-changed.v1'].parse({
    ...common,
    id: '019a6b44-0a1b-7c2d-8e3f-4a5b6c7d8e01',
    version: 4,
    method: 'reset',
    closedSessionCount: 3,
    client,
    recipient: { email: camilleMartin.email, name: camilleMartin.name },
  }),
  emailChanged: eventSchemas['user.email-changed.v1'].parse({
    ...common,
    id: '019a6b44-0a1b-7c2d-8e3f-4a5b6c7d8e02',
    version: 5,
    email: 'camille@ateliernord.fr',
    previousEmail: camilleMartin.email,
    name: camilleMartin.name,
    client,
  }),
  newDevice: eventSchemas['session.opened-on-new-device.v1'].parse({
    ...common,
    id: '019a6b44-0a1b-7c2d-8e3f-4a5b6c7d8e05',
    version: 1,
    sessionId: '019a6914-2f7a-7b3c-9d4e-5f6a7b8c9d01',
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
  }),
  scheduled: eventSchemas['user.deletion-scheduled.v1'].parse({
    ...common,
    id: '019a6b44-0a1b-7c2d-8e3f-4a5b6c7d8e03',
    version: 6,
    deleteAt: '2026-12-09T13:10:00.000Z',
    recipient: { email: camilleMartin.email, name: camilleMartin.name },
  }),
  cancelled: eventSchemas['user.deletion-cancelled.v1'].parse({
    ...common,
    id: '019a6b44-0a1b-7c2d-8e3f-4a5b6c7d8e04',
    version: 7,
    sessionId: '019a6f02-3c4d-7e5f-8a6b-7c8d9e0f1a20',
    client,
    recipient: { email: camilleMartin.email, name: camilleMartin.name },
  }),
};

describe('AccountSecurityEventsHandler', () => {
  let renderer: HandlebarsEmailRenderer;
  let deliveries: InMemorySecurityEmailDeliveries;
  let queue: InMemorySecurityEmailQueue;
  let sender: RecordingEmailSender;
  let sendSecurityEmail: SendSecurityEmail;
  let subscriptions: Map<EventName, RegisteredSubscription>;

  /**
   * Function deliver
   *
   * @description
   * Delivers an event to its registered handler, as the kit does after validating it.
   *
   * @param {EventName} event - Name of the event.
   * @param {unknown} payload - The event.
   * @returns {Promise<void>} Settles once the handler did.
   */
  async function deliver(event: EventName, payload: unknown): Promise<void> {
    const subscription: RegisteredSubscription | undefined = subscriptions.get(event);
    if (subscription === undefined) {
      throw new Error(`No handler subscribed to ${event}.`);
    }
    await subscription.handle(payload as never, context);
  }

  /**
   * Function workQueue
   *
   * @description
   * Runs the job of every enqueued delivery once, as the worker of `email.send-security` would.
   *
   * @returns {Promise<void>} Settles once every job ran.
   */
  async function workQueue(): Promise<void> {
    for (const deliveryId of queue.enqueued) {
      await sendSecurityEmail.execute({ deliveryId, lastAttempt: false });
    }
  }

  beforeAll(async () => {
    // The handler logs each outcome; the console of the test run stays quiet.
    Logger.overrideLogger(false);
    renderer = await HandlebarsEmailRenderer.load('http://app.cadenway.localhost');
  });

  afterAll(() => {
    Logger.overrideLogger(['log', 'error', 'warn', 'debug', 'verbose', 'fatal']);
  });

  beforeEach(async () => {
    deliveries = new InMemorySecurityEmailDeliveries();
    queue = new InMemorySecurityEmailQueue();
    sender = new RecordingEmailSender();
    const clock: FixedClock = new FixedClock(new Date('2026-11-09T13:10:01.000Z'));
    sendSecurityEmail = new SendSecurityEmail(
      new ImmediateUnitOfWork(),
      deliveries,
      renderer,
      sender,
      clock,
    );
    subscriptions = new Map<EventName, RegisteredSubscription>();
    const consumers: Pick<EventConsumers, 'subscribe'> = {
      subscribe: (registered: unknown): Promise<void> => {
        const subscription: RegisteredSubscription = registered as RegisteredSubscription;
        subscriptions.set(subscription.event, subscription);
        return Promise.resolve();
      },
    };
    const handler: AccountSecurityEventsHandler = new AccountSecurityEventsHandler(
      consumers as EventConsumers,
      new RequestSecurityEmail(new ImmediateUnitOfWork(), deliveries, queue, clock),
    );
    await handler.onApplicationBootstrap();
  });

  it('subscribes one consumer per event, by the names cadenway-ops grants, from new messages on', () => {
    expect(
      [...subscriptions.values()].map((subscription) => ({
        handler: subscription.handler,
        event: subscription.event,
        deliverPolicy: subscription.deliverPolicy,
        schemas: subscription.schemas === eventSchemas,
      })),
    ).toEqual([
      {
        handler: 'request-password-reset-email',
        event: 'password-reset-link.issued.v1',
        deliverPolicy: 'new',
        schemas: true,
      },
      {
        handler: 'request-password-changed-email',
        event: 'user.password-changed.v1',
        deliverPolicy: 'new',
        schemas: true,
      },
      {
        handler: 'request-email-changed-email',
        event: 'user.email-changed.v1',
        deliverPolicy: 'new',
        schemas: true,
      },
      {
        handler: 'request-new-device-email',
        event: 'session.opened-on-new-device.v1',
        deliverPolicy: 'new',
        schemas: true,
      },
      {
        handler: 'request-deletion-scheduled-email',
        event: 'user.deletion-scheduled.v1',
        deliverPolicy: 'new',
        schemas: true,
      },
      {
        handler: 'request-deletion-cancelled-email',
        event: 'user.deletion-cancelled.v1',
        deliverPolicy: 'new',
        schemas: true,
      },
    ]);
  });

  it('sends one French security e-mail per event, whatever the language of the account', async () => {
    await deliver('password-reset-link.issued.v1', events.reset);
    await deliver('user.password-changed.v1', events.changed);
    await deliver('user.email-changed.v1', events.emailChanged);
    await deliver('session.opened-on-new-device.v1', events.newDevice);
    await deliver('user.deletion-scheduled.v1', events.scheduled);
    await deliver('user.deletion-cancelled.v1', events.cancelled);
    await workQueue();

    expect(
      sender.sent.map((email) => ({
        subject: email.subject,
        to: email.to,
        unsubscribe: email.unsubscribe,
      })),
    ).toEqual([
      {
        subject: 'Réinitialisez votre mot de passe Cadenway',
        to: { address: camilleMartin.email, name: camilleMartin.name },
        unsubscribe: false,
      },
      {
        subject: 'Votre mot de passe a été modifié',
        to: { address: camilleMartin.email, name: camilleMartin.name },
        unsubscribe: false,
      },
      {
        subject: 'L’adresse e-mail de votre compte a été modifiée',
        to: { address: camilleMartin.email, name: camilleMartin.name },
        unsubscribe: false,
      },
      {
        subject: 'Nouvelle connexion depuis Safari sur iOS',
        to: { address: camilleMartin.email, name: camilleMartin.name },
        unsubscribe: false,
      },
      {
        subject: 'La suppression de votre compte est programmée',
        to: { address: camilleMartin.email, name: camilleMartin.name },
        unsubscribe: false,
      },
      {
        subject: 'La suppression de votre compte est annulée',
        to: { address: camilleMartin.email, name: camilleMartin.name },
        unsubscribe: false,
      },
    ]);
  });

  it('sends the address-change notice to the previous address, naming the new one', async () => {
    await deliver('user.email-changed.v1', events.emailChanged);
    await workQueue();

    expect(sender.sent[0]?.to.address).toBe('camille.martin@ateliernord.fr');
    expect(sender.sent[0]?.text).toContain('remplacée par camille@ateliernord.fr');
  });

  it('puts the token of the event in the reset link of the e-mail', async () => {
    await deliver('password-reset-link.issued.v1', events.reset);
    await workQueue();

    expect(sender.sent[0]?.text).toContain(
      'http://app.cadenway.localhost/reset#token=ExampleOnlyResetToken0000000000000000000000',
    );
    expect(sender.sent[0]?.text).toContain('Le lien expire dans 30 minutes.');
  });

  it('sends one e-mail when the same event is delivered again', async () => {
    await deliver('user.password-changed.v1', events.changed);
    await workQueue();
    await deliver('user.password-changed.v1', events.changed);
    await workQueue();

    expect(sender.sent).toHaveLength(1);
    expect(deliveries.deliveries.size).toBe(1);
  });
});
