import type {
  CodeEmailPurpose,
  CodeEmailSkipReason,
  CodeValidity,
} from '../../domain/code-email.js';
import type { OneTimeCode } from '../../domain/one-time-code.js';

/**
 * Type CodeEmailDeliveryStatus
 *
 * @description
 * Where a code e-mail stands in the send log: `queued` until its job sends it (`sent`), finds its
 * code expired (`skipped`) or gives up after its last attempt (`failed`); `skipped` from the start
 * when the event arrived with an expired code or a purpose without template.
 *
 * @type {'queued' | 'sent' | 'skipped' | 'failed'}
 */
export type CodeEmailDeliveryStatus = 'queued' | 'sent' | 'skipped' | 'failed';

/**
 * Interface CodeEmailDeliveryDraft
 *
 * @description
 * A delivery to record in the send log when an event arrives. It names the event, the code and the
 * account by their ids and never holds the code nor the address.
 */
export interface CodeEmailDeliveryDraft {
  // #region Properties
  /**
   * Property eventId
   *
   * @description
   * Id of the `one-time-code.issued.v1` event: one delivery per event, whatever the redeliveries.
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
   * What the code proves, which decides the template.
   *
   * @type {CodeEmailPurpose}
   * @readonly
   */
  readonly purpose: CodeEmailPurpose;

  /**
   * Property language
   *
   * @description
   * BCP 47 language tag of the account, as the event gives it.
   *
   * @type {string}
   * @readonly
   */
  readonly language: string;

  /**
   * Property validity
   *
   * @description
   * When the code was issued and stops working.
   *
   * @type {CodeValidity}
   * @readonly
   */
  readonly validity: CodeValidity;

  /**
   * Property skipReason
   *
   * @description
   * Why the e-mail is not sent, recorded as `skipped`; `null` to record it `queued`.
   *
   * @type {CodeEmailSkipReason | null}
   * @readonly
   */
  readonly skipReason: CodeEmailSkipReason | null;
  // #endregion
}

/**
 * Interface CodeEmailContent
 *
 * @description
 * What only the e-mail itself shows: the code and the recipient. Kept apart from the send log,
 * only while the delivery is `queued`, and deleted as soon as the e-mail is sent, skipped or
 * failed.
 */
export interface CodeEmailContent {
  // #region Properties
  /**
   * Property code
   *
   * @description
   * The single-use code.
   *
   * @type {OneTimeCode}
   * @readonly
   */
  readonly code: OneTimeCode;

  /**
   * Property recipientEmail
   *
   * @description
   * Address to send to. Personal data, never logged.
   *
   * @type {string}
   * @readonly
   */
  readonly recipientEmail: string;

  /**
   * Property recipientName
   *
   * @description
   * Name of the account for the greeting, cleaned by `greetingName`; empty when nothing showable
   * was left.
   *
   * @type {string}
   * @readonly
   */
  readonly recipientName: string;
  // #endregion
}

/**
 * Interface CodeEmailDelivery
 *
 * @description
 * A row of the send log, as the job that sends it reads it.
 */
export interface CodeEmailDelivery {
  // #region Properties
  /**
   * Property id
   *
   * @description
   * Id of the delivery, the payload and the idempotency key of its job.
   *
   * @type {string}
   * @readonly
   */
  readonly id: string;

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
   * Property status
   *
   * @description
   * Where the delivery stands.
   *
   * @type {CodeEmailDeliveryStatus}
   * @readonly
   */
  readonly status: CodeEmailDeliveryStatus;

  /**
   * Property validity
   *
   * @description
   * When the code was issued and stops working.
   *
   * @type {CodeValidity}
   * @readonly
   */
  readonly validity: CodeValidity;

  /**
   * Property content
   *
   * @description
   * The code and the recipient while the delivery is `queued`; `null` once they were deleted.
   *
   * @type {CodeEmailContent | null}
   * @readonly
   */
  readonly content: CodeEmailContent | null;
  // #endregion
}

/**
 * Interface CodeEmailDeliveries
 *
 * @description
 * The send log of the code e-mails (`code_email_deliveries`) and the content of the e-mails not
 * sent yet (`pending_code_emails`). Each call runs in a transaction of the system runner of the
 * kit, and joins the one of the `CodeEmailUnitOfWork` when there is one.
 */
export interface CodeEmailDeliveries {
  // #region Methods
  /**
   * Method record
   *
   * @description
   * Records a delivery, with its content when it is to be sent. A delivery already recorded for
   * the same event is left as it is and nothing is written.
   *
   * @param {CodeEmailDeliveryDraft} draft - The delivery.
   * @param {CodeEmailContent | null} content - The code and the recipient of a `queued` delivery;
   * `null` for a `skipped` one.
   * @returns {Promise<string | null>} The id of the new delivery, or `null` when the event was
   * already recorded.
   */
  record(draft: CodeEmailDeliveryDraft, content: CodeEmailContent | null): Promise<string | null>;

  /**
   * Method find
   *
   * @description
   * Reads a delivery with its content.
   *
   * @param {string} deliveryId - Id of the delivery.
   * @returns {Promise<CodeEmailDelivery | null>} The delivery, or `null` when it does not exist.
   */
  find(deliveryId: string): Promise<CodeEmailDelivery | null>;

  /**
   * Method markSent
   *
   * @description
   * Marks a `queued` delivery `sent`, now, and deletes its content. A delivery in another state
   * is left as it is.
   *
   * @param {string} deliveryId - Id of the delivery.
   * @returns {Promise<void>} Settles once committed.
   */
  markSent(deliveryId: string): Promise<void>;

  /**
   * Method markSkipped
   *
   * @description
   * Marks a `queued` delivery `skipped` for a reason and deletes its content. A delivery in another
   * state is left as it is.
   *
   * @param {string} deliveryId - Id of the delivery.
   * @param {CodeEmailSkipReason} reason - Why it is not sent.
   * @returns {Promise<void>} Settles once committed.
   */
  markSkipped(deliveryId: string, reason: CodeEmailSkipReason): Promise<void>;

  /**
   * Method markFailed
   *
   * @description
   * Marks a `queued` delivery `failed`, after its last attempt, and deletes its content. A delivery
   * in another state is left as it is.
   *
   * @param {string} deliveryId - Id of the delivery.
   * @returns {Promise<void>} Settles once committed.
   */
  markFailed(deliveryId: string): Promise<void>;

  /**
   * Method expireStale
   *
   * @description
   * Settles every delivery still `queued` whose code expired: marks it `skipped` for `expired` and
   * deletes its content, then deletes any content left whose code expired. This catches what no
   * job attempt settles: a job deleted before it started, a last attempt failed by a crash or a
   * timeout. Rows another transaction holds are left to the next sweep.
   *
   * @param {Date} now - The current instant.
   * @returns {Promise<number>} How many deliveries were settled.
   */
  expireStale(now: Date): Promise<number>;
  // #endregion
}

/**
 * Constant CODE_EMAIL_DELIVERIES
 *
 * @description
 * Injection token of the `CodeEmailDeliveries`.
 *
 * @type {unique symbol}
 */
export const CODE_EMAIL_DELIVERIES: unique symbol = Symbol('CodeEmailDeliveries');
