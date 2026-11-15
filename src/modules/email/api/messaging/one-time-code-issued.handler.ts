import { eventSchemas, ONE_TIME_CODE_ISSUED_V1 } from '@cadenway/contracts/events/identity-service';
import type { OneTimeCodeIssuedV1 } from '@cadenway/contracts/events/identity-service';
import { EventConsumers } from '@cadenway/nest-messaging';
import { Injectable, Logger } from '@nestjs/common';
import type { OnApplicationBootstrap } from '@nestjs/common';

import { RequestCodeEmail } from '../../application/commands/request-code-email.js';
import type { RequestCodeEmailResult } from '../../application/commands/request-code-email.js';

/**
 * Constant HANDLER
 *
 * @description
 * Name of the handler, hence of its durable consumer `notification-service__request-code-email` on
 * `EVENTS_RESTRICTED`, named after its use case and apart from the job `email.send-code`. Renaming
 * it creates a new consumer.
 *
 * @type {string}
 */
const HANDLER: string = 'request-code-email';

/**
 * Class OneTimeCodeIssuedHandler
 *
 * @description
 * Consumes `one-time-code.issued.v1`, the restricted event of identity-service that carries a
 * single-use code to e-mail. The event is listed in `restrictedEvents` of `MessagingModule`
 * (`RESTRICTED_EVENT_NAMES` of the contracts), so its consumer reads `EVENTS_RESTRICTED` on
 * `restricted.one-time-code.issued.v1`, the stream only this service may read.
 *
 * The kit validates the payload with `eventSchemas` of `@cadenway/contracts` (an invalid one is a
 * dead letter at once, whose restricted body is dropped) and records its id with the PostgreSQL
 * deduplicator, in the system transaction the use case joins: a redelivery of a handled event is
 * skipped. `deliverPolicy: 'new'`: the handler has an outside effect, so a new consumer does not
 * replay the codes the stream still holds.
 *
 * It maps the event to `RequestCodeEmail` and logs the outcome at `info` with ids only: never the
 * code, the address or the name.
 */
@Injectable()
export class OneTimeCodeIssuedHandler implements OnApplicationBootstrap {
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
  private readonly logger: Logger = new Logger(OneTimeCodeIssuedHandler.name);

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
   * Property requestCodeEmail
   *
   * @description
   * The use case the event triggers.
   *
   * @type {RequestCodeEmail}
   * @readonly
   */
  private readonly requestCodeEmail: RequestCodeEmail;
  // #endregion

  // #region Constructor
  /**
   * Constructor
   *
   * @description
   * Receives the event consumers and the use case.
   *
   * @param {EventConsumers} consumers - The event consumers of the kit.
   * @param {RequestCodeEmail} requestCodeEmail - The use case.
   * @constructor
   */
  public constructor(consumers: EventConsumers, requestCodeEmail: RequestCodeEmail) {
    this.consumers = consumers;
    this.requestCodeEmail = requestCodeEmail;
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
      event: ONE_TIME_CODE_ISSUED_V1,
      deliverPolicy: 'new',
      handle: (payload: OneTimeCodeIssuedV1): Promise<void> => this.handle(payload),
    });
  }

  /**
   * Method handle
   *
   * @description
   * Hands one validated event to the use case. A rejection makes the kit redeliver the event, up
   * to five deliveries, then copy it as a dead letter without its body.
   *
   * @param {OneTimeCodeIssuedV1} payload - The validated event.
   * @returns {Promise<void>} Settles once the delivery and its job are committed.
   */
  public async handle(payload: OneTimeCodeIssuedV1): Promise<void> {
    const result: RequestCodeEmailResult = await this.requestCodeEmail.execute({
      eventId: payload.id,
      codeId: payload.codeId,
      userId: payload.userId,
      purpose: payload.purpose,
      code: payload.code,
      issuedAt: new Date(payload.occurredAt),
      expiresAt: new Date(payload.expiresAt),
      recipient: { email: payload.recipient.email, name: payload.recipient.name },
      language: payload.language,
    });
    const fields: Readonly<Record<string, string>> = {
      eventId: payload.id,
      codeId: payload.codeId,
      userId: payload.userId,
      purpose: payload.purpose,
    };
    switch (result.outcome) {
      case 'queued':
        this.logger.log({ ...fields, deliveryId: result.deliveryId }, 'code e-mail queued');
        break;
      case 'skipped':
        // A purpose without template is a code nobody receives: an operator must see it.
        if (result.reason === 'purpose-not-supported') {
          this.logger.warn(
            { ...fields, deliveryId: result.deliveryId, reason: result.reason },
            'code e-mail not sent: no template for this purpose yet',
          );
        } else {
          this.logger.log(
            { ...fields, deliveryId: result.deliveryId, reason: result.reason },
            'code e-mail skipped',
          );
        }
        break;
      case 'duplicate':
        this.logger.log(fields, 'code e-mail already recorded for this event');
        break;
    }
  }
  // #endregion
}
