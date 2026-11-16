import codeEmailDeliveries from '../../schemas/code-email/code-email-deliveries.schema.js';
import pendingCodeEmails from '../../schemas/code-email/pending-code-emails.schema.js';
import { SystemTransactionRunner } from '@cadenway/nest-common/database';
import type { TransactionScope } from '@cadenway/nest-common/database';
import { Injectable } from '@nestjs/common';
import { and, eq, lte, sql } from 'drizzle-orm';
import type { CodeEmailContent } from '../../../../../application/models/code-email/code-email-content.model.js';
import type { CodeEmailDeliveries } from '../../../../../application/ports/outbound/persistence/code-email/code-email-deliveries.port.js';
import type { CodeEmailDelivery } from '../../../../../application/models/code-email/code-email-delivery.model.js';
import type { CodeEmailDeliveryDraft } from '../../../../../application/models/code-email/code-email-delivery-draft.model.js';
import type { CodeEmailDeliveryStatus } from '../../../../../application/models/code-email/code-email-delivery-status.model.js';
import { CodeValidity } from '../../../../../domain/value-objects/code-email/code-validity.value-object.js';
import type { CodeEmailPurpose } from '../../../../../domain/value-objects/code-email/code-email-purpose.value-object.js';
import type { CodeEmailSkipReason } from '../../../../../domain/value-objects/code-email/code-email-skip-reason.value-object.js';
import { OneTimeCode } from '../../../../../domain/value-objects/code-email/one-time-code.value-object.js';

/**
 * Constant PURPOSES
 *
 * @description
 * The values of `code_email_deliveries.purpose`, as its check constraint allows them.
 *
 * @type {readonly CodeEmailPurpose[]}
 */
const PURPOSES: readonly CodeEmailPurpose[] = ['email-verification', 'sign-in', 'email-change'];

/**
 * Constant STATUSES
 *
 * @description
 * The values of `code_email_deliveries.status`, as its check constraint allows them.
 *
 * @type {readonly CodeEmailDeliveryStatus[]}
 */
const STATUSES: readonly CodeEmailDeliveryStatus[] = ['queued', 'sent', 'skipped', 'failed'];

/**
 * Constant EXPIRE_BATCH
 *
 * @description
 * Deliveries one sweep settles at most, so its transaction stays short; the next sweep takes the
 * rest.
 *
 * @type {number}
 */
const EXPIRE_BATCH: number = 1_000;

/**
 * Function oneOf
 *
 * @description
 * Narrows a stored text to the values a check constraint allows.
 *
 * @param {readonly TValue[]} allowed - The allowed values.
 * @param {string} value - The stored value.
 * @param {string} column - Name of the column, for the error.
 * @returns {TValue} The value, narrowed.
 * @throws {Error} When the value is not allowed, which only a manual change can cause.
 */
function oneOf<TValue extends string>(
  allowed: readonly TValue[],
  value: string,
  column: string,
): TValue {
  const found: TValue | undefined = allowed.find((candidate) => candidate === value);
  if (found === undefined) {
    throw new Error(`code_email_deliveries.${column} holds a value this version does not know.`);
  }
  return found;
}

/**
 * Class DrizzleCodeEmailDeliveryRepository
 *
 * @description
 * `CodeEmailDeliveries` on the tables `code_email_deliveries` (the send log) and
 * `pending_code_emails` (the code and the recipient of a `queued` delivery) of this service's own
 * database. Every call runs in a transaction of the system runner of the kit, and joins the one
 * already open around it: the transaction of `CodeEmailUnitOfWork`, or the one in which the
 * deduplicator of the kit handles an event. The tables admit the system runner only.
 *
 * A change of state applies to a `queued` delivery only and deletes its pending content in the
 * same transaction, so the code and the address never outlive the e-mail.
 */
@Injectable()
export class DrizzleCodeEmailDeliveryRepository implements CodeEmailDeliveries {
  // #region Properties
  /**
   * Property system
   *
   * @description
   * The system transaction runner of the kit.
   *
   * @type {SystemTransactionRunner}
   * @readonly
   */
  private readonly system: SystemTransactionRunner;
  // #endregion

  // #region Constructor
  /**
   * Constructor
   *
   * @description
   * Receives the system transaction runner of `DatabaseModule`.
   *
   * @param {SystemTransactionRunner} system - The system transaction runner.
   * @constructor
   */
  public constructor(system: SystemTransactionRunner) {
    this.system = system;
  }
  // #endregion

  // #region Methods
  /**
   * Method record
   *
   * @description
   * Inserts the delivery, unless one exists for the same event (`on conflict do nothing` on the
   * unique `event_id`), then its content when there is one.
   *
   * @param {CodeEmailDeliveryDraft} draft - The delivery.
   * @param {CodeEmailContent | null} content - The code and the recipient, or `null`.
   * @returns {Promise<string | null>} The id of the new delivery, or `null` for a known event.
   */
  public async record(
    draft: CodeEmailDeliveryDraft,
    content: CodeEmailContent | null,
  ): Promise<string | null> {
    return this.system.run(async (tx: TransactionScope): Promise<string | null> => {
      const inserted: readonly { readonly id: string }[] = await tx.db
        .insert(codeEmailDeliveries)
        .values({
          eventId: draft.eventId,
          codeId: draft.codeId,
          userId: draft.userId,
          purpose: draft.purpose,
          language: draft.language,
          issuedAt: draft.validity.issuedAt,
          expiresAt: draft.validity.expiresAt,
          status: draft.skipReason === null ? 'queued' : 'skipped',
          skipReason: draft.skipReason,
        })
        .onConflictDoNothing({ target: codeEmailDeliveries.eventId })
        .returning({ id: codeEmailDeliveries.id });
      const id: string | undefined = inserted[0]?.id;
      if (id === undefined) {
        return null;
      }
      if (content !== null) {
        await tx.db.insert(pendingCodeEmails).values({
          deliveryId: id,
          code: content.code.reveal(),
          recipientEmail: content.recipientEmail,
          recipientName: content.recipientName,
          expiresAt: draft.validity.expiresAt,
        });
      }
      return id;
    });
  }

  /**
   * Method find
   *
   * @description
   * Reads a delivery and, when it still exists, its content.
   *
   * @param {string} deliveryId - Id of the delivery.
   * @returns {Promise<CodeEmailDelivery | null>} The delivery, or `null`.
   */
  public async find(deliveryId: string): Promise<CodeEmailDelivery | null> {
    return this.system.run(async (tx: TransactionScope): Promise<CodeEmailDelivery | null> => {
      const rows: readonly {
        readonly id: string;
        readonly purpose: string;
        readonly status: string;
        readonly issuedAt: Date;
        readonly expiresAt: Date;
        readonly code: string | null;
        readonly recipientEmail: string | null;
        readonly recipientName: string | null;
      }[] = await tx.db
        .select({
          id: codeEmailDeliveries.id,
          purpose: codeEmailDeliveries.purpose,
          status: codeEmailDeliveries.status,
          issuedAt: codeEmailDeliveries.issuedAt,
          expiresAt: codeEmailDeliveries.expiresAt,
          code: pendingCodeEmails.code,
          recipientEmail: pendingCodeEmails.recipientEmail,
          recipientName: pendingCodeEmails.recipientName,
        })
        .from(codeEmailDeliveries)
        .leftJoin(pendingCodeEmails, eq(pendingCodeEmails.deliveryId, codeEmailDeliveries.id))
        .where(eq(codeEmailDeliveries.id, deliveryId))
        .limit(1);
      const row: (typeof rows)[number] | undefined = rows[0];
      if (row === undefined) {
        return null;
      }
      return {
        id: row.id,
        purpose: oneOf(PURPOSES, row.purpose, 'purpose'),
        status: oneOf(STATUSES, row.status, 'status'),
        validity: CodeValidity.between(row.issuedAt, row.expiresAt),
        content:
          row.code === null || row.recipientEmail === null || row.recipientName === null
            ? null
            : {
                code: OneTimeCode.of(row.code),
                recipientEmail: row.recipientEmail,
                recipientName: row.recipientName,
              },
      };
    });
  }

  /**
   * Method markSent
   *
   * @description
   * Marks a `queued` delivery `sent` now and deletes its content.
   *
   * @param {string} deliveryId - Id of the delivery.
   * @returns {Promise<void>} Settles once committed.
   */
  public async markSent(deliveryId: string): Promise<void> {
    await this.settle(deliveryId, 'sent', null);
  }

  /**
   * Method markSkipped
   *
   * @description
   * Marks a `queued` delivery `skipped` for a reason and deletes its content.
   *
   * @param {string} deliveryId - Id of the delivery.
   * @param {CodeEmailSkipReason} reason - Why it is not sent.
   * @returns {Promise<void>} Settles once committed.
   */
  public async markSkipped(deliveryId: string, reason: CodeEmailSkipReason): Promise<void> {
    await this.settle(deliveryId, 'skipped', reason);
  }

  /**
   * Method markFailed
   *
   * @description
   * Marks a `queued` delivery `failed` and deletes its content.
   *
   * @param {string} deliveryId - Id of the delivery.
   * @returns {Promise<void>} Settles once committed.
   */
  public async markFailed(deliveryId: string): Promise<void> {
    await this.settle(deliveryId, 'failed', null);
  }

  /**
   * Method expireStale
   *
   * @description
   * Settles up to `EXPIRE_BATCH` `queued` deliveries whose code expired, oldest first, through the
   * partial index on their `expires_at`; rows another transaction holds (an attempt marking them)
   * are skipped (`for update skip locked`) and left to that attempt or to the next sweep. Then
   * deletes every pending content whose code expired, through the index on its `expires_at`.
   *
   * @param {Date} now - The current instant.
   * @returns {Promise<number>} How many deliveries were settled.
   */
  public async expireStale(now: Date): Promise<number> {
    return this.system.run(async (tx: TransactionScope): Promise<number> => {
      const settled: { readonly rows: unknown[] } = await tx.client.query(
        `with stale as (
           select id from code_email_deliveries
            where status = 'queued' and expires_at <= $1
            order by expires_at
            limit $2
            for update skip locked
         )
         update code_email_deliveries as delivery
            set status = 'skipped', skip_reason = 'expired', version = delivery.version + 1,
                updated_at = now()
           from stale
          where delivery.id = stale.id
         returning delivery.id`,
        [now, EXPIRE_BATCH],
      );
      await tx.db.delete(pendingCodeEmails).where(lte(pendingCodeEmails.expiresAt, now));
      return settled.rows.length;
    });
  }

  /**
   * Method settle
   *
   * @description
   * Moves a `queued` delivery to its final state, raising its version, and deletes its content,
   * in one transaction. A delivery already settled keeps its state; its content is deleted anyway.
   *
   * @param {string} deliveryId - Id of the delivery.
   * @param {Exclude<CodeEmailDeliveryStatus, 'queued'>} status - The final state.
   * @param {CodeEmailSkipReason | null} skipReason - The reason of a `skipped` delivery, else
   * `null`.
   * @returns {Promise<void>} Settles once committed.
   */
  private async settle(
    deliveryId: string,
    status: Exclude<CodeEmailDeliveryStatus, 'queued'>,
    skipReason: CodeEmailSkipReason | null,
  ): Promise<void> {
    await this.system.run(async (tx: TransactionScope): Promise<void> => {
      await tx.db
        .update(codeEmailDeliveries)
        .set({
          status,
          skipReason,
          sentAt: status === 'sent' ? sql`now()` : null,
          version: sql`${codeEmailDeliveries.version} + 1`,
          updatedAt: sql`now()`,
        })
        .where(
          and(eq(codeEmailDeliveries.id, deliveryId), eq(codeEmailDeliveries.status, 'queued')),
        );
      await tx.db.delete(pendingCodeEmails).where(eq(pendingCodeEmails.deliveryId, deliveryId));
    });
  }
  // #endregion
}
