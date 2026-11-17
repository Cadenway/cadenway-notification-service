import {
  eventSchemas,
  PASSWORD_RESET_LINK_ISSUED_V1,
  SESSION_OPENED_ON_NEW_DEVICE_V1,
  USER_DELETION_CANCELLED_V1,
  USER_DELETION_SCHEDULED_V1,
  USER_EMAIL_CHANGED_V1,
  USER_PASSWORD_CHANGED_V1,
} from '@cadenway/contracts/events/identity-service';
import type {
  PasswordResetLinkIssuedV1,
  SessionOpenedOnNewDeviceV1,
  UserDeletionCancelledV1,
  UserDeletionScheduledV1,
  UserEmailChangedV1,
  UserPasswordChangedV1,
} from '@cadenway/contracts/events/identity-service';
import { EventConsumers } from '@cadenway/nest-messaging';
import { Injectable, Logger } from '@nestjs/common';
import type { OnApplicationBootstrap } from '@nestjs/common';
import { RequestSecurityEmail } from '../../../../application/use-cases/commands/security-email/request-security-email/request-security-email.use-case.js';
import type { RequestSecurityEmailInput } from '../../../../application/use-cases/commands/security-email/request-security-email/request-security-email.input.js';
import type { RequestSecurityEmailOutput } from '../../../../application/use-cases/commands/security-email/request-security-email/request-security-email.output.js';

/**
 * Constant HANDLERS
 *
 * @description
 * Names of the handlers, hence of their durable consumers `notification-service__<name>`, one per
 * event, named after the e-mail they request and granted by these exact names in cadenway-ops.
 * Renaming one creates a new consumer, which needs its grant first.
 *
 * @type {Readonly<Record<'passwordReset' | 'passwordChanged' | 'emailChanged' | 'newDevice' | 'deletionScheduled' | 'deletionCancelled', string>>}
 */
const HANDLERS: Readonly<
  Record<
    | 'passwordReset'
    | 'passwordChanged'
    | 'emailChanged'
    | 'newDevice'
    | 'deletionScheduled'
    | 'deletionCancelled',
    string
  >
> = {
  passwordReset: 'request-password-reset-email',
  passwordChanged: 'request-password-changed-email',
  emailChanged: 'request-email-changed-email',
  newDevice: 'request-new-device-email',
  deletionScheduled: 'request-deletion-scheduled-email',
  deletionCancelled: 'request-deletion-cancelled-email',
};

/**
 * Class AccountSecurityEventsHandler
 *
 * @description
 * Consumes the six account events of identity-service that each ask for one security e-mail
 * ("Sécurité · toujours envoyé"), one durable consumer per event:
 *
 * - `password-reset-link.issued.v1`, restricted: read from `EVENTS_RESTRICTED` on
 *   `restricted.password-reset-link.issued.v1` (it is in `RESTRICTED_EVENT_NAMES`, hence in
 *   `restrictedEvents` of `MessagingModule`), the stream only this service may read; consumer
 *   `notification-service__request-password-reset-email`;
 * - `user.password-changed.v1`, `user.email-changed.v1`, `session.opened-on-new-device.v1`,
 *   `user.deletion-scheduled.v1` and `user.deletion-cancelled.v1`: read from `EVENTS` on
 *   `evt.<name>`; consumers `notification-service__request-password-changed-email`,
 *   `…__request-email-changed-email`, `…__request-new-device-email`,
 *   `…__request-deletion-scheduled-email` and `…__request-deletion-cancelled-email`.
 *
 * The kit validates each payload with `eventSchemas` of `@cadenway/contracts` (an invalid one is a
 * dead letter at once; the body of a restricted one is dropped) and records its id with the
 * PostgreSQL deduplicator, in the system transaction the use case joins: a redelivery of a handled
 * event is skipped. `deliverPolicy: 'new'` on every consumer: an e-mail is an outside effect, so a
 * new consumer does not replay the seven days of events its stream keeps.
 *
 * Each event maps to `RequestSecurityEmail`, and the outcome is logged at `info` with ids only:
 * never the address, the name, the device, the IP address nor the reset token.
 */
@Injectable()
export class AccountSecurityEventsHandler implements OnApplicationBootstrap {
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
  private readonly logger: Logger = new Logger(AccountSecurityEventsHandler.name);

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
   * Property requestSecurityEmail
   *
   * @description
   * The use case every event triggers.
   *
   * @type {RequestSecurityEmail}
   * @readonly
   */
  private readonly requestSecurityEmail: RequestSecurityEmail;
  // #endregion

  // #region Constructor
  /**
   * Constructor
   *
   * @description
   * Receives the event consumers and the use case.
   *
   * @param {EventConsumers} consumers - The event consumers of the kit.
   * @param {RequestSecurityEmail} requestSecurityEmail - The use case.
   * @constructor
   */
  public constructor(consumers: EventConsumers, requestSecurityEmail: RequestSecurityEmail) {
    this.consumers = consumers;
    this.requestSecurityEmail = requestSecurityEmail;
  }
  // #endregion

  // #region Methods
  /**
   * Method onApplicationBootstrap
   *
   * @description
   * Registers the six handlers once the application has started.
   *
   * @returns {Promise<void>} Settles once the six durable consumers exist.
   */
  public async onApplicationBootstrap(): Promise<void> {
    await this.consumers.subscribe({
      handler: HANDLERS.passwordReset,
      schemas: eventSchemas,
      event: PASSWORD_RESET_LINK_ISSUED_V1,
      deliverPolicy: 'new',
      handle: (payload: PasswordResetLinkIssuedV1): Promise<void> =>
        this.handlePasswordResetLinkIssued(payload),
    });
    await this.consumers.subscribe({
      handler: HANDLERS.passwordChanged,
      schemas: eventSchemas,
      event: USER_PASSWORD_CHANGED_V1,
      deliverPolicy: 'new',
      handle: (payload: UserPasswordChangedV1): Promise<void> =>
        this.handlePasswordChanged(payload),
    });
    await this.consumers.subscribe({
      handler: HANDLERS.emailChanged,
      schemas: eventSchemas,
      event: USER_EMAIL_CHANGED_V1,
      deliverPolicy: 'new',
      handle: (payload: UserEmailChangedV1): Promise<void> => this.handleEmailChanged(payload),
    });
    await this.consumers.subscribe({
      handler: HANDLERS.newDevice,
      schemas: eventSchemas,
      event: SESSION_OPENED_ON_NEW_DEVICE_V1,
      deliverPolicy: 'new',
      handle: (payload: SessionOpenedOnNewDeviceV1): Promise<void> =>
        this.handleSessionOpenedOnNewDevice(payload),
    });
    await this.consumers.subscribe({
      handler: HANDLERS.deletionScheduled,
      schemas: eventSchemas,
      event: USER_DELETION_SCHEDULED_V1,
      deliverPolicy: 'new',
      handle: (payload: UserDeletionScheduledV1): Promise<void> =>
        this.handleDeletionScheduled(payload),
    });
    await this.consumers.subscribe({
      handler: HANDLERS.deletionCancelled,
      schemas: eventSchemas,
      event: USER_DELETION_CANCELLED_V1,
      deliverPolicy: 'new',
      handle: (payload: UserDeletionCancelledV1): Promise<void> =>
        this.handleDeletionCancelled(payload),
    });
  }

  /**
   * Method handlePasswordResetLinkIssued
   *
   * @description
   * Asks for the "Réinitialisation du mot de passe" e-mail, whose link carries the token of the
   * event. A rejection makes the kit redeliver the event, up to five deliveries, then copy it as a
   * dead letter without its body.
   *
   * @param {PasswordResetLinkIssuedV1} payload - The validated event.
   * @returns {Promise<void>} Settles once the delivery and its job are committed.
   */
  public async handlePasswordResetLinkIssued(payload: PasswordResetLinkIssuedV1): Promise<void> {
    await this.request(
      { linkId: payload.linkId },
      {
        eventId: payload.id,
        userId: payload.userId,
        occurredAt: new Date(payload.occurredAt),
        recipient: { email: payload.recipient.email, name: payload.recipient.name },
        language: payload.language,
        timeZone: payload.timeZone,
        request: {
          template: 'password-reset',
          token: payload.token,
          expiresAt: new Date(payload.expiresAt),
          client: payload.client,
        },
      },
    );
  }

  /**
   * Method handlePasswordChanged
   *
   * @description
   * Asks for the "Mot de passe modifié" e-mail, which says what happened to the other sessions.
   *
   * @param {UserPasswordChangedV1} payload - The validated event.
   * @returns {Promise<void>} Settles once the delivery and its job are committed.
   */
  public async handlePasswordChanged(payload: UserPasswordChangedV1): Promise<void> {
    await this.request(
      {},
      {
        eventId: payload.id,
        userId: payload.userId,
        occurredAt: new Date(payload.occurredAt),
        recipient: { email: payload.recipient.email, name: payload.recipient.name },
        language: payload.language,
        timeZone: payload.timeZone,
        request: {
          template: 'password-changed',
          method: payload.method,
          closedSessionCount: payload.closedSessionCount,
          client: payload.client,
        },
      },
    );
  }

  /**
   * Method handleEmailChanged
   *
   * @description
   * Asks for the notice of a changed address, sent to the previous address (`previousEmail`), which
   * names the new one.
   *
   * @param {UserEmailChangedV1} payload - The validated event.
   * @returns {Promise<void>} Settles once the delivery and its job are committed.
   */
  public async handleEmailChanged(payload: UserEmailChangedV1): Promise<void> {
    await this.request(
      {},
      {
        eventId: payload.id,
        userId: payload.userId,
        occurredAt: new Date(payload.occurredAt),
        recipient: { email: payload.previousEmail, name: payload.name },
        language: payload.language,
        timeZone: payload.timeZone,
        request: { template: 'email-changed', newEmail: payload.email, client: payload.client },
      },
    );
  }

  /**
   * Method handleSessionOpenedOnNewDevice
   *
   * @description
   * Asks for the "Nouvelle connexion" e-mail.
   *
   * @param {SessionOpenedOnNewDeviceV1} payload - The validated event.
   * @returns {Promise<void>} Settles once the delivery and its job are committed.
   */
  public async handleSessionOpenedOnNewDevice(payload: SessionOpenedOnNewDeviceV1): Promise<void> {
    await this.request(
      { sessionId: payload.sessionId },
      {
        eventId: payload.id,
        userId: payload.userId,
        occurredAt: new Date(payload.occurredAt),
        recipient: { email: payload.recipient.email, name: payload.recipient.name },
        language: payload.language,
        timeZone: payload.timeZone,
        request: { template: 'new-device', client: payload.client },
      },
    );
  }

  /**
   * Method handleDeletionScheduled
   *
   * @description
   * Asks for the "Suppression du compte" e-mail, dated by `deleteAt`.
   *
   * @param {UserDeletionScheduledV1} payload - The validated event.
   * @returns {Promise<void>} Settles once the delivery and its job are committed.
   */
  public async handleDeletionScheduled(payload: UserDeletionScheduledV1): Promise<void> {
    await this.request(
      {},
      {
        eventId: payload.id,
        userId: payload.userId,
        occurredAt: new Date(payload.occurredAt),
        recipient: { email: payload.recipient.email, name: payload.recipient.name },
        language: payload.language,
        timeZone: payload.timeZone,
        request: { template: 'deletion-scheduled', deleteAt: new Date(payload.deleteAt) },
      },
    );
  }

  /**
   * Method handleDeletionCancelled
   *
   * @description
   * Asks for the notice of a deletion cancelled by a sign-in.
   *
   * @param {UserDeletionCancelledV1} payload - The validated event.
   * @returns {Promise<void>} Settles once the delivery and its job are committed.
   */
  public async handleDeletionCancelled(payload: UserDeletionCancelledV1): Promise<void> {
    await this.request(
      { sessionId: payload.sessionId },
      {
        eventId: payload.id,
        userId: payload.userId,
        occurredAt: new Date(payload.occurredAt),
        recipient: { email: payload.recipient.email, name: payload.recipient.name },
        language: payload.language,
        timeZone: payload.timeZone,
        request: { template: 'deletion-cancelled', client: payload.client },
      },
    );
  }

  /**
   * Method request
   *
   * @description
   * Hands an event to the use case and logs its outcome with ids only.
   *
   * @param {Readonly<Record<string, string>>} ids - Ids of the event worth logging besides its own
   * and its account's: the link or the session.
   * @param {RequestSecurityEmailInput} input - The event, mapped.
   * @returns {Promise<void>} Settles once the delivery and its job are committed.
   */
  private async request(
    ids: Readonly<Record<string, string>>,
    input: RequestSecurityEmailInput,
  ): Promise<void> {
    const result: RequestSecurityEmailOutput = await this.requestSecurityEmail.execute(input);
    const fields: Readonly<Record<string, string>> = {
      eventId: input.eventId,
      userId: input.userId,
      template: input.request.template,
      ...ids,
    };
    switch (result.outcome) {
      case 'queued':
        this.logger.log({ ...fields, deliveryId: result.deliveryId }, 'security e-mail queued');
        break;
      case 'skipped':
        this.logger.log(
          { ...fields, deliveryId: result.deliveryId, reason: result.reason },
          'security e-mail skipped',
        );
        break;
      case 'duplicate':
        this.logger.log(fields, 'security e-mail already recorded for this event');
        break;
    }
  }
  // #endregion
}
