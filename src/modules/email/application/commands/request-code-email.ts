import { CodeValidity, decideCodeEmail } from '../../domain/code-email.js';
import type {
  CodeEmailDecision,
  CodeEmailPurpose,
  CodeEmailSkipReason,
} from '../../domain/code-email.js';
import { OneTimeCode } from '../../domain/one-time-code.js';
import { greetingName } from '../../domain/recipient-name.js';
import type { Clock } from '../ports/clock.port.js';
import type { CodeEmailDeliveries } from '../ports/code-email-deliveries.port.js';
import type { CodeEmailQueue } from '../ports/code-email-queue.port.js';
import type { CodeEmailUnitOfWork } from '../ports/code-email-unit-of-work.port.js';

/**
 * Interface RequestCodeEmailInput
 *
 * @description
 * An issued code to e-mail, from a validated `one-time-code.issued.v1` event.
 */
export interface RequestCodeEmailInput {
  // #region Properties
  /**
   * Property eventId
   *
   * @description
   * Id of the event, the key that makes the use case idempotent.
   *
   * @type {string}
   * @readonly
   */
  readonly eventId: string;

  /**
   * Property codeId
   *
   * @description
   * Id of the code in identity-service.
   *
   * @type {string}
   * @readonly
   */
  readonly codeId: string;

  /**
   * Property userId
   *
   * @description
   * Account the code is for.
   *
   * @type {string}
   * @readonly
   */
  readonly userId: string;

  /**
   * Property purpose
   *
   * @description
   * What the code proves.
   *
   * @type {CodeEmailPurpose}
   * @readonly
   */
  readonly purpose: CodeEmailPurpose;

  /**
   * Property code
   *
   * @description
   * The 6 digits. A secret: the use case keeps it with the content of the e-mail only, never in
   * the send log.
   *
   * @type {string}
   * @readonly
   */
  readonly code: string;

  /**
   * Property issuedAt
   *
   * @description
   * When the code was issued (`occurredAt` of the event).
   *
   * @type {Date}
   * @readonly
   */
  readonly issuedAt: Date;

  /**
   * Property expiresAt
   *
   * @description
   * When the code stops working.
   *
   * @type {Date}
   * @readonly
   */
  readonly expiresAt: Date;

  /**
   * Property recipient
   *
   * @description
   * Who receives the e-mail.
   *
   * @type {{ readonly email: string; readonly name: string }}
   * @readonly
   */
  readonly recipient: { readonly email: string; readonly name: string };

  /**
   * Property language
   *
   * @description
   * BCP 47 language tag of the account.
   *
   * @type {string}
   * @readonly
   */
  readonly language: string;
  // #endregion
}

/**
 * Type RequestCodeEmailResult
 *
 * @description
 * What became of the code: `queued`, its e-mail is recorded and its job enqueued; `skipped`, it is
 * recorded without a job, for a reason; `duplicate`, the event was already handled and nothing was
 * written.
 *
 * @type {{ readonly outcome: 'queued'; readonly deliveryId: string } | { readonly outcome: 'skipped'; readonly deliveryId: string; readonly reason: CodeEmailSkipReason } | { readonly outcome: 'duplicate' }}
 */
export type RequestCodeEmailResult =
  | { readonly outcome: 'queued'; readonly deliveryId: string }
  | {
      readonly outcome: 'skipped';
      readonly deliveryId: string;
      readonly reason: CodeEmailSkipReason;
    }
  | { readonly outcome: 'duplicate' };

/**
 * Class RequestCodeEmail
 *
 * @description
 * Takes an issued code in charge: decides whether its e-mail leaves (`decideCodeEmail`), records
 * the delivery in the send log and, when it leaves, keeps its content apart and enqueues its job,
 * in one transaction of the `CodeEmailUnitOfWork`. Nothing is sent here: the job sends, outside any
 * transaction.
 *
 * Idempotent on the event id: a redelivery that the deduplicator of the kit would not have caught
 * finds the delivery already recorded and writes nothing, so it never enqueues a second e-mail.
 */
export class RequestCodeEmail {
  // #region Properties
  /**
   * Property unitOfWork
   *
   * @description
   * The transaction of the use case.
   *
   * @type {CodeEmailUnitOfWork}
   * @readonly
   */
  private readonly unitOfWork: CodeEmailUnitOfWork;

  /**
   * Property deliveries
   *
   * @description
   * The send log and the pending contents.
   *
   * @type {CodeEmailDeliveries}
   * @readonly
   */
  private readonly deliveries: CodeEmailDeliveries;

  /**
   * Property queue
   *
   * @description
   * The queue of the code e-mails.
   *
   * @type {CodeEmailQueue}
   * @readonly
   */
  private readonly queue: CodeEmailQueue;

  /**
   * Property clock
   *
   * @description
   * The current instant, to tell an expired code.
   *
   * @type {Clock}
   * @readonly
   */
  private readonly clock: Clock;
  // #endregion

  // #region Constructor
  /**
   * Constructor
   *
   * @description
   * Receives the ports of the use case.
   *
   * @param {CodeEmailUnitOfWork} unitOfWork - The transaction of the use case.
   * @param {CodeEmailDeliveries} deliveries - The send log and the pending contents.
   * @param {CodeEmailQueue} queue - The queue of the code e-mails.
   * @param {Clock} clock - The current instant.
   * @constructor
   */
  public constructor(
    unitOfWork: CodeEmailUnitOfWork,
    deliveries: CodeEmailDeliveries,
    queue: CodeEmailQueue,
    clock: Clock,
  ) {
    this.unitOfWork = unitOfWork;
    this.deliveries = deliveries;
    this.queue = queue;
    this.clock = clock;
  }
  // #endregion

  // #region Methods
  /**
   * Method execute
   *
   * @description
   * Records the e-mail of an issued code, and enqueues it when it is to be sent. The name of the
   * recipient is kept as `greetingName` cleans it: it was typed before the address was verified.
   *
   * @param {RequestCodeEmailInput} input - The issued code.
   * @returns {Promise<RequestCodeEmailResult>} What became of it, once committed.
   * @throws {InvalidOneTimeCodeError} When the code is not 6 digits.
   * @throws {InvalidCodeValidityError} When the code expires before it was issued.
   */
  public async execute(input: RequestCodeEmailInput): Promise<RequestCodeEmailResult> {
    const code: OneTimeCode = OneTimeCode.of(input.code);
    const validity: CodeValidity = CodeValidity.between(input.issuedAt, input.expiresAt);
    const decision: CodeEmailDecision = decideCodeEmail(input.purpose, validity, this.clock.now());
    const skipReason: CodeEmailSkipReason | null =
      decision.kind === 'skip' ? decision.reason : null;

    return this.unitOfWork.run(async (): Promise<RequestCodeEmailResult> => {
      const deliveryId: string | null = await this.deliveries.record(
        {
          eventId: input.eventId,
          codeId: input.codeId,
          userId: input.userId,
          purpose: input.purpose,
          language: input.language,
          validity,
          skipReason,
        },
        skipReason === null
          ? {
              code,
              recipientEmail: input.recipient.email,
              recipientName: greetingName(input.recipient.name),
            }
          : null,
      );
      if (deliveryId === null) {
        return { outcome: 'duplicate' };
      }
      if (skipReason !== null) {
        return { outcome: 'skipped', deliveryId, reason: skipReason };
      }
      await this.queue.enqueue(deliveryId);
      return { outcome: 'queued', deliveryId };
    });
  }
  // #endregion
}
