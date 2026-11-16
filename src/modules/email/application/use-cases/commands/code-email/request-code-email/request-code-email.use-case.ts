import { CodeValidity } from '../../../../../domain/value-objects/code-email/code-validity.value-object.js';
import { decideCodeEmail } from '../../../../../domain/policies/code-email/code-email.policy.js';
import type { CodeEmailDecision } from '../../../../../domain/policies/code-email/code-email-decision.policy.js';
import type { CodeEmailSkipReason } from '../../../../../domain/value-objects/code-email/code-email-skip-reason.value-object.js';
import { OneTimeCode } from '../../../../../domain/value-objects/code-email/one-time-code.value-object.js';
import { greetingName } from '../../../../../domain/policies/code-email/recipient-name.policy.js';
import type { Clock } from '../../../../ports/outbound/time/code-email/clock.port.js';
import type { CodeEmailDeliveries } from '../../../../ports/outbound/persistence/code-email/code-email-deliveries.port.js';
import type { CodeEmailQueue } from '../../../../ports/outbound/jobs/code-email/code-email-queue.port.js';
import type { CodeEmailUnitOfWork } from '../../../../ports/outbound/persistence/code-email/code-email-unit-of-work.port.js';
import type { RequestCodeEmailInput } from './request-code-email.input.js';
import type { RequestCodeEmailOutput } from './request-code-email.output.js';

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
   * @returns {Promise<RequestCodeEmailOutput>} What became of it, once committed.
   * @throws {InvalidOneTimeCodeError} When the code is not 6 digits.
   * @throws {InvalidCodeValidityError} When the code expires before it was issued.
   */
  public async execute(input: RequestCodeEmailInput): Promise<RequestCodeEmailOutput> {
    const code: OneTimeCode = OneTimeCode.of(input.code);
    const validity: CodeValidity = CodeValidity.between(input.issuedAt, input.expiresAt);
    const decision: CodeEmailDecision = decideCodeEmail(input.purpose, validity, this.clock.now());
    const skipReason: CodeEmailSkipReason | null =
      decision.kind === 'skip' ? decision.reason : null;

    return this.unitOfWork.run(async (): Promise<RequestCodeEmailOutput> => {
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
