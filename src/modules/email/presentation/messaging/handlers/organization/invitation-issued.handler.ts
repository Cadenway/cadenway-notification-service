import {
  eventSchemas,
  INVITATION_ISSUED_V1,
} from '@cadenway/contracts/events/organization-service';
import type { InvitationIssuedV1 } from '@cadenway/contracts/events/organization-service';
import { EventConsumers } from '@cadenway/nest-messaging';
import type { EventContext } from '@cadenway/nest-messaging';
import { Injectable, Logger } from '@nestjs/common';
import type { OnApplicationBootstrap } from '@nestjs/common';
import { RequestInvitationEmail } from '../../../../application/use-cases/commands/invitation-email/request-invitation-email/request-invitation-email.use-case.js';
import type { RequestInvitationEmailOutput } from '../../../../application/use-cases/commands/invitation-email/request-invitation-email/request-invitation-email.output.js';

/**
 * Constant HANDLER
 *
 * @description
 * Name of the handler, hence of its durable consumer `notification-service__request-invitation-email`
 * on `EVENTS`, named after its use case and apart from the job `email.send-invitation`. Renaming it
 * creates a new consumer.
 *
 * @type {string}
 */
const HANDLER: string = 'request-invitation-email';

/**
 * Class InvitationIssuedHandler
 *
 * @description
 * Consumes `invitation.issued.v1` of organization-service, the invitation (or its resend) whose
 * e-mail must go out, from `EVENTS` on `evt.invitation.issued.v1`: the event carries no secret,
 * since only the account whose verified address is the invited one can accept the invitation.
 *
 * The kit validates the payload with `eventSchemas` of `@cadenway/contracts` (an invalid one is a
 * dead letter at once) and handles it in a tenant transaction of the organization of the event,
 * in which it records the event id (a redelivery of a handled event is skipped) and in which the
 * use case runs. `claimVersion` keeps, per invitation, the latest version received: an older one,
 * arriving late, is recorded `superseded` and sends nothing, as the contract requires.
 *
 * `deliverPolicy: 'new'`: the handler sends e-mails, so the consumer, when it is first created,
 * starts with the invitations published from then on and does not replay the seven days of events
 * `EVENTS` keeps. Once created, the durable consumer resumes where it stopped, across restarts and
 * deployments. Should the kit ever recreate it from the start of the stream, the processed ids, the
 * unique event id of the send log, the latest-version rule and the expiry keep a replayed
 * invitation from being e-mailed twice.
 *
 * It maps the event to `RequestInvitationEmail` and logs the outcome at `info` with ids only:
 * never the address or a name.
 */
@Injectable()
export class InvitationIssuedHandler implements OnApplicationBootstrap {
  // #region Properties
  /**
   * Property logger
   *
   * @description
   * Logger of the handler, routed to the JSON logs of the kit.
   *
   * @type {Logger}
   * @readonly
   */
  private readonly logger: Logger = new Logger(InvitationIssuedHandler.name);

  /**
   * Property consumers
   *
   * @description
   * The event consumers of `MessagingModule`.
   *
   * @type {EventConsumers}
   * @readonly
   */
  private readonly consumers: EventConsumers;

  /**
   * Property requestInvitationEmail
   *
   * @description
   * The use case the event triggers.
   *
   * @type {RequestInvitationEmail}
   * @readonly
   */
  private readonly requestInvitationEmail: RequestInvitationEmail;
  // #endregion

  // #region Constructor
  /**
   * Constructor
   *
   * @description
   * Receives the event consumers and the use case.
   *
   * @param {EventConsumers} consumers - The event consumers of the kit.
   * @param {RequestInvitationEmail} requestInvitationEmail - The use case.
   * @constructor
   */
  public constructor(consumers: EventConsumers, requestInvitationEmail: RequestInvitationEmail) {
    this.consumers = consumers;
    this.requestInvitationEmail = requestInvitationEmail;
  }
  // #endregion

  // #region Methods
  /**
   * Method onApplicationBootstrap
   *
   * @description
   * Registers the handler once the application has started.
   *
   * @returns {Promise<void>} Settles once the durable consumer exists.
   */
  public async onApplicationBootstrap(): Promise<void> {
    await this.consumers.subscribe({
      handler: HANDLER,
      schemas: eventSchemas,
      event: INVITATION_ISSUED_V1,
      deliverPolicy: 'new',
      handle: (payload: InvitationIssuedV1, context: EventContext): Promise<void> =>
        this.handle(payload, context),
    });
  }

  /**
   * Method handle
   *
   * @description
   * Claims the version of the invitation, then hands the event to the use case, in the
   * transaction of the deduplicator. A rejection rolls both back and makes the kit redeliver the
   * event, up to five deliveries, then copy it as a dead letter.
   *
   * @param {InvitationIssuedV1} payload - The validated event.
   * @param {EventContext} context - The delivery, with the version store of the consumer.
   * @returns {Promise<void>} Settles once the delivery and its job are committed.
   */
  public async handle(payload: InvitationIssuedV1, context: EventContext): Promise<void> {
    const latestVersion: boolean = await context.claimVersion(`invitation:${payload.invitationId}`);
    const result: RequestInvitationEmailOutput = await this.requestInvitationEmail.execute({
      eventId: payload.id,
      invitationId: payload.invitationId,
      version: payload.version,
      latestVersion,
      recipientEmail: payload.email,
      role: payload.role,
      inviterName: payload.inviter.name,
      organizationName: payload.organization.name,
      memberCount: payload.organization.memberCount,
      issuedAt: new Date(payload.occurredAt),
      expiresAt: new Date(payload.expiresAt),
      language: payload.language,
    });
    const fields: Readonly<Record<string, string | number>> = {
      eventId: payload.id,
      organizationId: payload.organizationId,
      version: payload.version,
    };
    switch (result.outcome) {
      case 'queued':
        this.logger.log(
          { ...fields, deliveryId: result.deliveryId, superseded: result.superseded },
          'invitation e-mail queued',
        );
        break;
      case 'skipped':
        this.logger.log(
          { ...fields, deliveryId: result.deliveryId, reason: result.reason },
          'invitation e-mail skipped',
        );
        break;
      case 'duplicate':
        this.logger.log(fields, 'invitation e-mail already recorded for this event');
        break;
    }
  }
  // #endregion
}
