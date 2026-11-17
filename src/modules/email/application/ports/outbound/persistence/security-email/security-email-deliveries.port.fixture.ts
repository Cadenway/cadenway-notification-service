import type { SecurityEmailSkipReason } from '../../../../../domain/value-objects/security-email/security-email-skip-reason.value-object.js';
import type { SecurityEmailContent } from '../../../../models/security-email/security-email-content.model.js';
import type { SecurityEmailDelivery } from '../../../../models/security-email/security-email-delivery.model.js';
import type { SecurityEmailDeliveryDraft } from '../../../../models/security-email/security-email-delivery-draft.model.js';
import type { SecurityEmailDeliveryStatus } from '../../../../models/security-email/security-email-delivery-status.model.js';
import type { SecurityEmailQueue } from '../../jobs/security-email/security-email-queue.port.js';
import type { SecurityEmailDeliveries } from './security-email-deliveries.port.js';

/**
 * Interface StoredSecurityEmailDelivery
 *
 * @description
 * A row of the in-memory send log, with the draft it was recorded from.
 */
export interface StoredSecurityEmailDelivery {
  // #region Properties
  /**
   * Property draft
   *
   * @description
   * The recorded draft.
   *
   * @type {SecurityEmailDeliveryDraft}
   * @readonly
   */
  readonly draft: SecurityEmailDeliveryDraft;

  /**
   * Property status
   *
   * @description
   * Where the delivery stands.
   *
   * @type {SecurityEmailDeliveryStatus}
   */
  status: SecurityEmailDeliveryStatus;

  /**
   * Property skipReason
   *
   * @description
   * Why it was skipped, or `null`.
   *
   * @type {SecurityEmailSkipReason | null}
   */
  skipReason: SecurityEmailSkipReason | null;
  // #endregion
}

/**
 * Class InMemorySecurityEmailDeliveries
 *
 * @description
 * `SecurityEmailDeliveries` in memory, with the rules of the PostgreSQL repository: one delivery
 * per event, a change of state from `queued` only, the content deleted with it.
 */
export class InMemorySecurityEmailDeliveries implements SecurityEmailDeliveries {
  // #region Properties
  /**
   * Property deliveries
   *
   * @description
   * The send log, by delivery id.
   *
   * @type {Map<string, StoredSecurityEmailDelivery>}
   * @readonly
   */
  public readonly deliveries: Map<string, StoredSecurityEmailDelivery> = new Map<
    string,
    StoredSecurityEmailDelivery
  >();

  /**
   * Property contents
   *
   * @description
   * The pending contents, by delivery id.
   *
   * @type {Map<string, SecurityEmailContent>}
   * @readonly
   */
  public readonly contents: Map<string, SecurityEmailContent> = new Map<
    string,
    SecurityEmailContent
  >();
  // #endregion

  // #region Methods
  /**
   * Method record
   *
   * @description
   * Records a delivery unless its event is known.
   *
   * @param {SecurityEmailDeliveryDraft} draft - The delivery.
   * @param {SecurityEmailContent | null} content - Its content, or `null`.
   * @returns {Promise<string | null>} The new id, or `null`.
   */
  public record(
    draft: SecurityEmailDeliveryDraft,
    content: SecurityEmailContent | null,
  ): Promise<string | null> {
    if ([...this.deliveries.values()].some((stored) => stored.draft.eventId === draft.eventId)) {
      return Promise.resolve(null);
    }
    const id: string = `01938f6e-0000-7000-9000-${String(this.deliveries.size + 1).padStart(12, '0')}`;
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
   * @returns {Promise<SecurityEmailDelivery | null>} The delivery, or `null`.
   */
  public find(deliveryId: string): Promise<SecurityEmailDelivery | null> {
    const stored: StoredSecurityEmailDelivery | undefined = this.deliveries.get(deliveryId);
    return Promise.resolve(
      stored === undefined
        ? null
        : {
            id: deliveryId,
            template: stored.draft.template,
            status: stored.status,
            window: stored.draft.window,
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
   * @param {SecurityEmailSkipReason} reason - Why.
   * @returns {Promise<void>} Settles at once.
   */
  public markSkipped(deliveryId: string, reason: SecurityEmailSkipReason): Promise<void> {
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
   * Settles the `queued` deliveries whose window closed and deletes every content past its window.
   *
   * @param {Date} now - The current instant.
   * @returns {Promise<number>} How many deliveries were settled.
   */
  public expireStale(now: Date): Promise<number> {
    let settled: number = 0;
    for (const [id, stored] of this.deliveries) {
      if (!stored.draft.window.isClosedAt(now)) {
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
   * @param {SecurityEmailDeliveryStatus} status - The final state.
   * @param {SecurityEmailSkipReason | null} skipReason - The reason, or `null`.
   */
  private settle(
    deliveryId: string,
    status: SecurityEmailDeliveryStatus,
    skipReason: SecurityEmailSkipReason | null,
  ): void {
    const stored: StoredSecurityEmailDelivery | undefined = this.deliveries.get(deliveryId);
    if (stored?.status === 'queued') {
      stored.status = status;
      stored.skipReason = skipReason;
    }
    this.contents.delete(deliveryId);
  }
  // #endregion
}

/**
 * Class InMemorySecurityEmailQueue
 *
 * @description
 * `SecurityEmailQueue` in memory: keeps the enqueued delivery ids, once each, like the occurrence
 * key of the job.
 */
export class InMemorySecurityEmailQueue implements SecurityEmailQueue {
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
