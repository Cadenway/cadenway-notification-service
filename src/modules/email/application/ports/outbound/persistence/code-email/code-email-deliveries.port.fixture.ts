import type { Clock } from '../../time/code-email/clock.port.js';
import type { CodeEmailContent } from '../../../../models/code-email/code-email-content.model.js';
import type { CodeEmailDeliveries } from './code-email-deliveries.port.js';
import type { CodeEmailDelivery } from '../../../../models/code-email/code-email-delivery.model.js';
import type { CodeEmailDeliveryDraft } from '../../../../models/code-email/code-email-delivery-draft.model.js';
import type { CodeEmailDeliveryStatus } from '../../../../models/code-email/code-email-delivery-status.model.js';
import type { CodeEmailQueue } from '../../jobs/code-email/code-email-queue.port.js';
import type { CodeEmailUnitOfWork } from './code-email-unit-of-work.port.js';
import type { EmailSender } from '../../smtp/code-email/email-sender.port.js';
import type { OutgoingEmail } from '../../../../models/code-email/outgoing-email.model.js';
import type { CodeEmailSkipReason } from '../../../../../domain/value-objects/code-email/code-email-skip-reason.value-object.js';

/**
 * Interface StoredDelivery
 *
 * @description
 * A row of the in-memory send log, with the draft it was recorded from.
 */
export interface StoredDelivery {
  // #region Properties
  /**
   * Property draft
   *
   * @description
   * The recorded draft.
   *
   * @type {CodeEmailDeliveryDraft}
   * @readonly
   */
  readonly draft: CodeEmailDeliveryDraft;

  /**
   * Property status
   *
   * @description
   * Where the delivery stands.
   *
   * @type {CodeEmailDeliveryStatus}
   */
  status: CodeEmailDeliveryStatus;

  /**
   * Property skipReason
   *
   * @description
   * Why it was skipped, or `null`.
   *
   * @type {CodeEmailSkipReason | null}
   */
  skipReason: CodeEmailSkipReason | null;
  // #endregion
}

/**
 * Class InMemoryCodeEmailDeliveries
 *
 * @description
 * `CodeEmailDeliveries` in memory, with the rules of the PostgreSQL repository: one delivery per
 * event, a change of state from `queued` only, the content deleted with it.
 */
export class InMemoryCodeEmailDeliveries implements CodeEmailDeliveries {
  // #region Properties
  /**
   * Property deliveries
   *
   * @description
   * The send log, by delivery id.
   *
   * @type {Map<string, StoredDelivery>}
   * @readonly
   */
  public readonly deliveries: Map<string, StoredDelivery> = new Map<string, StoredDelivery>();

  /**
   * Property contents
   *
   * @description
   * The pending contents, by delivery id.
   *
   * @type {Map<string, CodeEmailContent>}
   * @readonly
   */
  public readonly contents: Map<string, CodeEmailContent> = new Map<string, CodeEmailContent>();
  // #endregion

  // #region Methods
  /**
   * Method record
   *
   * @description
   * Records a delivery unless its event is known.
   *
   * @param {CodeEmailDeliveryDraft} draft - The delivery.
   * @param {CodeEmailContent | null} content - Its content, or `null`.
   * @returns {Promise<string | null>} The new id, or `null`.
   */
  public record(
    draft: CodeEmailDeliveryDraft,
    content: CodeEmailContent | null,
  ): Promise<string | null> {
    if ([...this.deliveries.values()].some((stored) => stored.draft.eventId === draft.eventId)) {
      return Promise.resolve(null);
    }
    const id: string = `01938f6e-0000-7000-8000-${String(this.deliveries.size + 1).padStart(12, '0')}`;
    this.deliveries.set(id, {
      draft,
      status: draft.skipReason === null ? 'queued' : 'skipped',
      skipReason: draft.skipReason,
    });
    if (content !== null) {
      this.contents.set(id, content);
    }
    return Promise.resolve(id);
  }

  /**
   * Method find
   *
   * @description
   * Reads a delivery with its content.
   *
   * @param {string} deliveryId - Id of the delivery.
   * @returns {Promise<CodeEmailDelivery | null>} The delivery, or `null`.
   */
  public find(deliveryId: string): Promise<CodeEmailDelivery | null> {
    const stored: StoredDelivery | undefined = this.deliveries.get(deliveryId);
    return Promise.resolve(
      stored === undefined
        ? null
        : {
            id: deliveryId,
            purpose: stored.draft.purpose,
            status: stored.status,
            validity: stored.draft.validity,
            content: this.contents.get(deliveryId) ?? null,
          },
    );
  }

  /**
   * Method markSent
   *
   * @description
   * Marks a `queued` delivery `sent`.
   *
   * @param {string} deliveryId - Id of the delivery.
   * @returns {Promise<void>} Settles at once.
   */
  public markSent(deliveryId: string): Promise<void> {
    this.settle(deliveryId, 'sent', null);
    return Promise.resolve();
  }

  /**
   * Method markSkipped
   *
   * @description
   * Marks a `queued` delivery `skipped`.
   *
   * @param {string} deliveryId - Id of the delivery.
   * @param {CodeEmailSkipReason} reason - Why.
   * @returns {Promise<void>} Settles at once.
   */
  public markSkipped(deliveryId: string, reason: CodeEmailSkipReason): Promise<void> {
    this.settle(deliveryId, 'skipped', reason);
    return Promise.resolve();
  }

  /**
   * Method markFailed
   *
   * @description
   * Marks a `queued` delivery `failed`.
   *
   * @param {string} deliveryId - Id of the delivery.
   * @returns {Promise<void>} Settles at once.
   */
  public markFailed(deliveryId: string): Promise<void> {
    this.settle(deliveryId, 'failed', null);
    return Promise.resolve();
  }

  /**
   * Method expireStale
   *
   * @description
   * Settles the `queued` deliveries whose code expired and deletes every expired content.
   *
   * @param {Date} now - The current instant.
   * @returns {Promise<number>} How many deliveries were settled.
   */
  public expireStale(now: Date): Promise<number> {
    let settled: number = 0;
    for (const [id, stored] of this.deliveries) {
      if (!stored.draft.validity.isExpiredAt(now)) {
        continue;
      }
      if (stored.status === 'queued') {
        stored.status = 'skipped';
        stored.skipReason = 'expired';
        settled += 1;
      }
      this.contents.delete(id);
    }
    return Promise.resolve(settled);
  }

  /**
   * Method settle
   *
   * @description
   * Moves a `queued` delivery to a final state and deletes its content.
   *
   * @param {string} deliveryId - Id of the delivery.
   * @param {CodeEmailDeliveryStatus} status - The final state.
   * @param {CodeEmailSkipReason | null} skipReason - The reason, or `null`.
   */
  private settle(
    deliveryId: string,
    status: CodeEmailDeliveryStatus,
    skipReason: CodeEmailSkipReason | null,
  ): void {
    const stored: StoredDelivery | undefined = this.deliveries.get(deliveryId);
    if (stored?.status === 'queued') {
      stored.status = status;
      stored.skipReason = skipReason;
    }
    this.contents.delete(deliveryId);
  }
  // #endregion
}

/**
 * Class InMemoryCodeEmailQueue
 *
 * @description
 * `CodeEmailQueue` in memory: keeps the enqueued delivery ids, once each, like the occurrence key
 * of the job.
 */
export class InMemoryCodeEmailQueue implements CodeEmailQueue {
  // #region Properties
  /**
   * Property enqueued
   *
   * @description
   * The delivery ids, in order.
   *
   * @type {string[]}
   * @readonly
   */
  public readonly enqueued: string[] = [];
  // #endregion

  // #region Methods
  /**
   * Method enqueue
   *
   * @description
   * Keeps a delivery id, unless it is already queued.
   *
   * @param {string} deliveryId - Id of the delivery.
   * @returns {Promise<void>} Settles at once.
   */
  public enqueue(deliveryId: string): Promise<void> {
    if (!this.enqueued.includes(deliveryId)) {
      this.enqueued.push(deliveryId);
    }
    return Promise.resolve();
  }
  // #endregion
}

/**
 * Class ImmediateUnitOfWork
 *
 * @description
 * `CodeEmailUnitOfWork` that runs the work as is and counts the transactions.
 */
export class ImmediateUnitOfWork implements CodeEmailUnitOfWork {
  // #region Properties
  /**
   * Property transactions
   *
   * @description
   * How many units of work ran.
   *
   * @type {number}
   */
  public transactions: number = 0;
  // #endregion

  // #region Methods
  /**
   * Method run
   *
   * @description
   * Runs the work.
   *
   * @param {() => Promise<TResult>} work - The work.
   * @returns {Promise<TResult>} Its result.
   */
  public run<TResult>(work: () => Promise<TResult>): Promise<TResult> {
    this.transactions += 1;
    return work();
  }
  // #endregion
}

/**
 * Class FixedClock
 *
 * @description
 * `Clock` at an instant the test moves.
 */
export class FixedClock implements Clock {
  // #region Properties
  /**
   * Property instant
   *
   * @description
   * The current instant of the test.
   *
   * @type {Date}
   */
  public instant: Date;
  // #endregion

  // #region Constructor
  /**
   * Constructor
   *
   * @description
   * Starts at an instant.
   *
   * @param {Date} instant - The first instant.
   * @constructor
   */
  public constructor(instant: Date) {
    this.instant = instant;
  }
  // #endregion

  // #region Methods
  /**
   * Method now
   *
   * @description
   * The current instant of the test.
   *
   * @returns {Date} A copy of it.
   */
  public now(): Date {
    return new Date(this.instant.getTime());
  }
  // #endregion
}

/**
 * Class RecordingEmailSender
 *
 * @description
 * `EmailSender` that keeps the e-mails, or fails while `failure` is set.
 */
export class RecordingEmailSender implements EmailSender {
  // #region Properties
  /**
   * Property sent
   *
   * @description
   * The e-mails handed over, in order.
   *
   * @type {OutgoingEmail[]}
   * @readonly
   */
  public readonly sent: OutgoingEmail[] = [];

  /**
   * Property failure
   *
   * @description
   * The error every send rejects with, or `null`.
   *
   * @type {Error | null}
   */
  public failure: Error | null = null;
  // #endregion

  // #region Methods
  /**
   * Method send
   *
   * @description
   * Keeps the e-mail, or rejects with `failure`.
   *
   * @param {OutgoingEmail} email - The e-mail.
   * @returns {Promise<void>} Settles at once.
   */
  public send(email: OutgoingEmail): Promise<void> {
    if (this.failure !== null) {
      return Promise.reject(this.failure);
    }
    this.sent.push(email);
    return Promise.resolve();
  }
  // #endregion
}
