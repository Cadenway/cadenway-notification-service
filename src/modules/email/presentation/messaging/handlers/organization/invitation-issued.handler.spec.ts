import { eventSchemas } from '@cadenway/contracts/events/organization-service';
import type { InvitationIssuedV1 } from '@cadenway/contracts/events/organization-service';
import type { EventConsumers, EventContext, EventSubscription } from '@cadenway/nest-messaging';
import { Logger } from '@nestjs/common';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  FixedClock,
  ImmediateUnitOfWork,
  RecordingEmailSender,
} from '../../../../application/ports/outbound/persistence/code-email/code-email-deliveries.port.fixture.js';
import {
  InMemoryInvitationEmailDeliveries,
  InMemoryInvitationEmailQueue,
} from '../../../../application/ports/outbound/persistence/invitation-email/invitation-email-deliveries.port.fixture.js';
import { RequestInvitationEmail } from '../../../../application/use-cases/commands/invitation-email/request-invitation-email/request-invitation-email.use-case.js';
import { SendInvitationEmail } from '../../../../application/use-cases/commands/invitation-email/send-invitation-email/send-invitation-email.use-case.js';
import { HandlebarsEmailRenderer } from '../../../../infrastructure/adapters/templates/handlebars-email-renderer.adapter.js';
import { InvitationIssuedHandler } from './invitation-issued.handler.js';

/**
 * Type OrganizationSubscription
 *
 * @description
 * The subscription the handler registers, as the kit receives it.
 *
 * @type {EventSubscription<typeof eventSchemas, 'invitation.issued.v1'>}
 */
type OrganizationSubscription = EventSubscription<typeof eventSchemas, 'invitation.issued.v1'>;

/**
 * Constant invitationId
 *
 * @description
 * The invitation of the mockup.
 *
 * @type {string}
 */
const invitationId: string = '01938f71-5d0b-7c3e-9a51-2f0c4b8d7e10';

/**
 * Function issuedEvent
 *
 * @description
 * The `invitation.issued.v1` event of the mockup, valid against the schema of the contract: Hugo
 * Durand invites Marc Roux to join Atelier Nord (18 members) as Membre, for 7 days.
 *
 * @param {Partial<InvitationIssuedV1>} overrides - Fields to change.
 * @returns {InvitationIssuedV1} The event.
 */
function issuedEvent(overrides: Partial<InvitationIssuedV1> = {}): InvitationIssuedV1 {
  return eventSchemas['invitation.issued.v1'].parse({
    id: '01938f71-1a2b-7c3d-8e4f-5a6b7c8d9e01',
    occurredAt: '2026-11-09T09:15:00.000Z',
    organizationId: '01938f6e-6d1a-7c3e-9a51-2f0c4b8d7e10',
    actor: { type: 'user', id: '01938f6e-1111-7d5b-b2c9-5e1f3a6d9c24' },
    version: 1,
    invitationId,
    email: 'marc.roux@ateliernord.fr',
    role: 'member',
    inviter: { userId: '01938f6e-1111-7d5b-b2c9-5e1f3a6d9c24', name: 'Hugo Durand' },
    organization: { name: 'Atelier Nord', memberCount: 18 },
    expiresAt: '2026-11-16T09:15:00.000Z',
    language: 'en',
    ...overrides,
  });
}

describe('InvitationIssuedHandler', () => {
  let renderer: HandlebarsEmailRenderer;
  let deliveries: InMemoryInvitationEmailDeliveries;
  let queue: InMemoryInvitationEmailQueue;
  let sender: RecordingEmailSender;
  let clock: FixedClock;
  let sendInvitationEmail: SendInvitationEmail;
  let subscription: OrganizationSubscription | undefined;
  let latestVersions: Map<string, number>;

  /**
   * Function deliver
   *
   * @description
   * Delivers an event to the registered handler, as the kit does after validating it, with a
   * version store that answers like the one of the PostgreSQL deduplicator.
   *
   * @param {InvitationIssuedV1} payload - The event.
   * @returns {Promise<void>} Settles once the handler did.
   */
  async function deliver(payload: InvitationIssuedV1): Promise<void> {
    if (subscription === undefined) {
      throw new Error('The handler did not subscribe.');
    }
    const context: EventContext = {
      deliveryCount: 1,
      streamSequence: 1,
      redelivered: false,
      claimVersion: (key: string): Promise<boolean> => {
        const known: number = latestVersions.get(key) ?? 0;
        if (payload.version <= known) {
          return Promise.resolve(false);
        }
        latestVersions.set(key, payload.version);
        return Promise.resolve(true);
      },
      signal: new AbortController().signal,
    };
    await subscription.handle(payload, context);
  }

  /**
   * Function workQueue
   *
   * @description
   * Runs the job of every enqueued delivery once, as the worker of `email.send-invitation` would.
   *
   * @returns {Promise<void>} Settles once every job ran.
   */
  async function workQueue(): Promise<void> {
    for (const deliveryId of queue.enqueued) {
      await sendInvitationEmail.execute({ deliveryId, lastAttempt: false });
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
    deliveries = new InMemoryInvitationEmailDeliveries();
    queue = new InMemoryInvitationEmailQueue();
    sender = new RecordingEmailSender();
    clock = new FixedClock(new Date('2026-11-09T09:15:01.000Z'));
    latestVersions = new Map<string, number>();
    sendInvitationEmail = new SendInvitationEmail(
      new ImmediateUnitOfWork(),
      deliveries,
      renderer,
      sender,
      clock,
    );
    subscription = undefined;
    const consumers: Pick<EventConsumers, 'subscribe'> = {
      subscribe: (registered: unknown): Promise<void> => {
        subscription = registered as OrganizationSubscription;
        return Promise.resolve();
      },
    };
    const handler: InvitationIssuedHandler = new InvitationIssuedHandler(
      consumers as EventConsumers,
      new RequestInvitationEmail(new ImmediateUnitOfWork(), deliveries, queue, clock),
    );
    await handler.onApplicationBootstrap();
  });

  it('subscribes to the event with the schemas of the contract, from new messages on', () => {
    expect(subscription).toMatchObject({
      handler: 'request-invitation-email',
      event: 'invitation.issued.v1',
      deliverPolicy: 'new',
    });
    expect(subscription?.schemas).toBe(eventSchemas);
  });

  it('sends the "Invitation" e-mail in French, whatever the language of the event', async () => {
    await deliver(issuedEvent());
    await workQueue();

    expect(sender.sent).toHaveLength(1);
    expect(sender.sent[0]).toMatchObject({
      to: { address: 'marc.roux@ateliernord.fr', name: '' },
      subject: 'Hugo Durand vous invite à rejoindre Atelier Nord',
      unsubscribe: true,
    });
    expect(sender.sent[0]?.text).toContain(
      `Rejoindre Atelier Nord : http://app.cadenway.localhost/invite/${invitationId}\n`,
    );
  });

  it('logs delivery correlation without the invitation link identifier', async () => {
    const log = vi.spyOn(Logger.prototype, 'log');
    const event: InvitationIssuedV1 = issuedEvent();
    try {
      await deliver(event);

      expect(log).toHaveBeenCalledWith(
        {
          eventId: event.id,
          organizationId: event.organizationId,
          version: event.version,
          deliveryId: queue.enqueued[0],
          superseded: 0,
        },
        'invitation e-mail queued',
      );
    } finally {
      log.mockRestore();
    }
  });

  it('sends one e-mail when the same event is delivered again', async () => {
    await deliver(issuedEvent());
    await workQueue();
    await deliver(issuedEvent());
    await workQueue();

    expect(sender.sent).toHaveLength(1);
    expect(deliveries.deliveries.size).toBe(1);
  });

  it('sends a second e-mail for a resend, a new event with the next version', async () => {
    await deliver(issuedEvent());
    await workQueue();
    await deliver(
      issuedEvent({
        id: '01938f71-1a2b-7c3d-8e4f-5a6b7c8d9e02',
        version: 2,
        occurredAt: '2026-11-10T09:15:00.000Z',
        expiresAt: '2026-11-17T09:15:00.000Z',
      }),
    );
    await workQueue();

    expect(sender.sent).toHaveLength(2);
    expect(sender.sent[1]?.text).toContain('L’invitation expire le 17 novembre 2026.');
  });

  it('sends nothing for a version older than one already received', async () => {
    await deliver(issuedEvent({ id: '01938f71-1a2b-7c3d-8e4f-5a6b7c8d9e02', version: 2 }));
    await workQueue();
    await deliver(issuedEvent());
    await workQueue();

    expect(sender.sent).toHaveLength(1);
    expect([...deliveries.deliveries.values()].map((stored) => stored.skipReason)).toEqual([
      null,
      'superseded',
    ]);
  });

  it('sends nothing for an invitation that expired before the event arrived', async () => {
    clock.instant = new Date('2026-11-16T09:15:00.000Z');

    await deliver(issuedEvent());
    await workQueue();

    expect(sender.sent).toEqual([]);
    expect([...deliveries.deliveries.values()]).toMatchObject([
      { status: 'skipped', skipReason: 'expired' },
    ]);
  });
});
