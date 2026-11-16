import { eventSchemas } from '@cadenway/contracts/events/identity-service';
import type { OneTimeCodeIssuedV1 } from '@cadenway/contracts/events/identity-service';
import type { EventConsumers, EventContext, EventSubscription } from '@cadenway/nest-messaging';
import { Logger } from '@nestjs/common';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { RequestCodeEmail } from '../../../../application/use-cases/commands/code-email/request-code-email/request-code-email.use-case.js';
import { SendCodeEmail } from '../../../../application/use-cases/commands/code-email/send-code-email/send-code-email.use-case.js';
import {
  FixedClock,
  ImmediateUnitOfWork,
  InMemoryCodeEmailDeliveries,
  InMemoryCodeEmailQueue,
  RecordingEmailSender,
} from '../../../../application/ports/outbound/persistence/code-email/code-email-deliveries.port.fixture.js';
import { HandlebarsEmailRenderer } from '../../../../infrastructure/adapters/templates/handlebars-email-renderer.adapter.js';
import { OneTimeCodeIssuedHandler } from './one-time-code-issued.handler.js';

/**
 * Type IdentitySubscription
 *
 * @description
 * The subscription the handler registers, as the kit receives it.
 *
 * @type {EventSubscription<typeof eventSchemas, 'one-time-code.issued.v1'>}
 */
type IdentitySubscription = EventSubscription<typeof eventSchemas, 'one-time-code.issued.v1'>;

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
 * Function issuedEvent
 *
 * @description
 * A `one-time-code.issued.v1` event for Camille Martin, valid against the schema of the contract.
 *
 * @param {Partial<OneTimeCodeIssuedV1>} overrides - Fields to change.
 * @returns {OneTimeCodeIssuedV1} The event.
 */
function issuedEvent(overrides: Partial<OneTimeCodeIssuedV1> = {}): OneTimeCodeIssuedV1 {
  return eventSchemas['one-time-code.issued.v1'].parse({
    id: '01938f6f-1a2b-7c3d-8e4f-5a6b7c8d9e01',
    occurredAt: '2026-11-09T13:07:00.000Z',
    organizationId: null,
    actor: { type: 'system', id: 'identity-service' },
    version: 1,
    codeId: '01938f6f-1a2b-7c3d-8e4f-5a6b7c8d9e02',
    userId: '01938f6e-8a42-7d5b-b2c9-5e1f3a6d9c24',
    purpose: 'email-verification',
    code: '482913',
    expiresAt: '2026-11-09T13:17:00.000Z',
    recipient: { email: 'camille.martin@ateliernord.fr', name: 'Camille Martin' },
    language: 'fr',
    ...overrides,
  });
}

describe('OneTimeCodeIssuedHandler', () => {
  let renderer: HandlebarsEmailRenderer;
  let deliveries: InMemoryCodeEmailDeliveries;
  let queue: InMemoryCodeEmailQueue;
  let sender: RecordingEmailSender;
  let clock: FixedClock;
  let sendCodeEmail: SendCodeEmail;
  let subscription: IdentitySubscription | undefined;

  /**
   * Function deliver
   *
   * @description
   * Delivers an event to the registered handler, as the kit does after validating it.
   *
   * @param {OneTimeCodeIssuedV1} payload - The event.
   * @returns {Promise<void>} Settles once the handler did.
   */
  async function deliver(payload: OneTimeCodeIssuedV1): Promise<void> {
    if (subscription === undefined) {
      throw new Error('The handler did not subscribe.');
    }
    await subscription.handle(payload, context);
  }

  /**
   * Function workQueue
   *
   * @description
   * Runs the job of every enqueued delivery once, as the worker of `email.send-code` would.
   *
   * @returns {Promise<void>} Settles once every job ran.
   */
  async function workQueue(): Promise<void> {
    for (const deliveryId of queue.enqueued) {
      await sendCodeEmail.execute({ deliveryId, lastAttempt: false });
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
    deliveries = new InMemoryCodeEmailDeliveries();
    queue = new InMemoryCodeEmailQueue();
    sender = new RecordingEmailSender();
    clock = new FixedClock(new Date('2026-11-09T13:07:01.000Z'));
    sendCodeEmail = new SendCodeEmail(
      new ImmediateUnitOfWork(),
      deliveries,
      renderer,
      sender,
      clock,
    );
    subscription = undefined;
    const consumers: Pick<EventConsumers, 'subscribe'> = {
      subscribe: (registered: unknown): Promise<void> => {
        subscription = registered as IdentitySubscription;
        return Promise.resolve();
      },
    };
    const handler: OneTimeCodeIssuedHandler = new OneTimeCodeIssuedHandler(
      consumers as EventConsumers,
      new RequestCodeEmail(new ImmediateUnitOfWork(), deliveries, queue, clock),
    );
    await handler.onApplicationBootstrap();
  });

  it('subscribes to the restricted event with the schemas of the contract, from new messages on', () => {
    expect(subscription).toMatchObject({
      handler: 'request-code-email',
      event: 'one-time-code.issued.v1',
      deliverPolicy: 'new',
    });
    expect(subscription?.schemas).toBe(eventSchemas);
  });

  it('sends the "Confirmation de l’adresse" e-mail with the code for a sign-up code', async () => {
    await deliver(issuedEvent());
    await workQueue();

    expect(sender.sent).toHaveLength(1);
    expect(sender.sent[0]).toMatchObject({
      to: { address: 'camille.martin@ateliernord.fr', name: 'Camille Martin' },
      subject: 'Confirmez votre adresse pour activer votre compte',
      oneClickUnsubscribe: false,
    });
    expect(sender.sent[0]?.text).toContain('    482 913\n');
  });

  it('sends the "Code de connexion" e-mail for a sign-in code', async () => {
    await deliver(issuedEvent({ purpose: 'sign-in' }));
    await workQueue();

    expect(sender.sent.map((email) => email.subject)).toEqual([
      '482 913 est votre code de connexion Cadenway',
    ]);
  });

  it('skips a code that already expired when the event arrives', async () => {
    clock.instant = new Date('2026-11-09T13:20:00.000Z');

    await deliver(issuedEvent());
    await workQueue();

    expect(queue.enqueued).toEqual([]);
    expect(sender.sent).toEqual([]);
    expect([...deliveries.deliveries.values()]).toMatchObject([
      { status: 'skipped', skipReason: 'expired' },
    ]);
  });

  it('sends one e-mail when the same event is delivered again', async () => {
    await deliver(issuedEvent());
    await workQueue();
    await deliver(issuedEvent());
    await workQueue();

    expect(sender.sent).toHaveLength(1);
    expect(deliveries.deliveries.size).toBe(1);
  });

  it('sends nothing yet for an address-change code', async () => {
    await deliver(issuedEvent({ purpose: 'email-change' }));
    await workQueue();

    expect(sender.sent).toEqual([]);
    expect([...deliveries.deliveries.values()]).toMatchObject([
      { status: 'skipped', skipReason: 'purpose-not-supported' },
    ]);
  });
});
