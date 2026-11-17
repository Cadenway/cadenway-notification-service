import type { InvitationEmailSkipReason } from '../../../../../domain/value-objects/invitation-email/invitation-email-skip-reason.value-object.js';
import type { InvitationEmailContent } from '../../../../models/invitation-email/invitation-email-content.model.js';
import type { InvitationEmailDeliveryDraft } from '../../../../models/invitation-email/invitation-email-delivery-draft.model.js';
import type { InvitationEmailDeliveryStatus } from '../../../../models/invitation-email/invitation-email-delivery-status.model.js';
import type { InvitationEmailDelivery } from '../../../../models/invitation-email/invitation-email-delivery.model.js';
import type { InvitationEmailQueue } from '../../jobs/invitation-email/invitation-email-queue.port.js';
import type { InvitationEmailDeliveries } from './invitation-email-deliveries.port.js';

/**
 * Interface StoredInvitationDelivery
 *
 * @description
 * A row of the in-memory send log, with the draft it was recorded from.
 */
export interface StoredInvitationDelivery {
  // #region Properties
  /**
   * Property draft
   *
   * @description
   * The recorded draft.
   *
   * @type {InvitationEmailDeliveryDraft}
   * @readonly
   */
  readonly draft: InvitationEmailDeliveryDraft;

  /**
   * Property status
   *
   * @description
   * Where the delivery stands.
   *
   * @type {InvitationEmailDeliveryStatus}
   */
  status: InvitationEmailDeliveryStatus;

  /**
   * Property skipReason
   *
   * @description
   * Why it was skipped, or `null`.
   *
   * @type {InvitationEmailSkipReason | null}
   */
  skipReason: InvitationEmailSkipReason | null;
  // #endregion
}

/**
 * Class InMemoryInvitationEmailDeliveries
 *
 * @description
 * `InvitationEmailDeliveries` in memory, for one organization, with the rules of the PostgreSQL
 * repository: one delivery per event, a change of state from `queued` only, the content deleted
 * with it.
 */
export class InMemoryInvitationEmailDeliveries implements InvitationEmailDeliveries {
  // #region Properties
  /**
   * Property deliveries
   *
   * @description
   * The send log, by delivery id.
   *
   * @type {Map<string, StoredInvitationDelivery>}
   * @readonly
   */
  public readonly deliveries: Map<string, StoredInvitationDelivery> = new Map<
    string,
    StoredInvitationDelivery
  >();

  /**
   * Property contents
   *
   * @description
   * The pending contents, by delivery id.
   *
   * @type {Map<string, InvitationEmailContent>}
   * @readonly
   */
  public readonly contents: Map<string, InvitationEmailContent> = new Map<
    string,
    InvitationEmailContent
  >();
  // #endregion

  // #region Methods
  /**
   * Method record
   *
   * @description
   * Records a delivery unless its event is known.
   *
   * @param {InvitationEmailDeliveryDraft} draft - The delivery.
   * @param {InvitationEmailContent | null} content - Its content, or `null`.
   * @returns {Promise<string | null>} The new id, or `null`.
   */
  public record(
    draft: InvitationEmailDeliveryDraft,
    content: InvitationEmailContent | null,
  ): Promise<string | null> {
    if ([...this.deliveries.values()].some((stored) => stored.draft.eventId === draft.eventId)) {
      return Promise.resolve(null);
    }
    const id: string = `01938f71-0000-7000-8000-${String(this.deliveries.size + 1).padStart(12, '0')}`;
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
   * Method supersede
   *
   * @description
   * Skips the `queued` deliveries of an invitation for an older version.
   *
   * @param {string} invitationId - Id of the invitation.
   * @param {number} version - The latest version.
   * @returns {Promise<number>} How many were superseded.
   */
  public supersede(invitationId: string, version: number): Promise<number> {
    let superseded: number = 0;
    for (const [id, stored] of this.deliveries) {
      if (
        stored.draft.invitationId === invitationId &&
        stored.draft.invitationVersion < version &&
        stored.status === 'queued'
      ) {
        this.settle(id, 'skipped', 'superseded');
        superseded += 1;
      }
    }
    return Promise.resolve(superseded);
  }

  /**
   * Method find
   *
   * @description
   * Reads a delivery with its content.
   *
   * @param {string} deliveryId - Id of the delivery.
   * @returns {Promise<InvitationEmailDelivery | null>} The delivery, or `null`.
   */
  public find(deliveryId: string): Promise<InvitationEmailDelivery | null> {
    const stored: StoredInvitationDelivery | undefined = this.deliveries.get(deliveryId);
    return Promise.resolve(
      stored === undefined
        ? null
        : {
            id: deliveryId,
            invitationId: stored.draft.invitationId,
            role: stored.draft.role,
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
   * @param {InvitationEmailSkipReason} reason - Why.
   * @returns {Promise<void>} Settles at once.
   */
  public markSkipped(deliveryId: string, reason: InvitationEmailSkipReason): Promise<void> {
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
   * Settles the `queued` deliveries whose invitation expired and deletes every expired content.
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
   * @param {InvitationEmailDeliveryStatus} status - The final state.
   * @param {InvitationEmailSkipReason | null} skipReason - The reason, or `null`.
   */
  private settle(
    deliveryId: string,
    status: InvitationEmailDeliveryStatus,
    skipReason: InvitationEmailSkipReason | null,
  ): void {
    const stored: StoredInvitationDelivery | undefined = this.deliveries.get(deliveryId);
    if (stored?.status === 'queued') {
      stored.status = status;
      stored.skipReason = skipReason;
    }
    this.contents.delete(deliveryId);
  }
  // #endregion
}

/**
 * Class InMemoryInvitationEmailQueue
 *
 * @description
 * `InvitationEmailQueue` in memory: keeps the enqueued delivery ids, once each, like the
 * occurrence key of the job.
 */
export class InMemoryInvitationEmailQueue implements InvitationEmailQueue {
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
