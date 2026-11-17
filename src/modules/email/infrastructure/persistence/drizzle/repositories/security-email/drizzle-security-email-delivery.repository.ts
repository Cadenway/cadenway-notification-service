import pendingSecurityEmails from '../../schemas/security-email/pending-security-emails.schema.js';
import securityEmailDeliveries from '../../schemas/security-email/security-email-deliveries.schema.js';
import { SystemTransactionRunner } from '@cadenway/nest-common/database';
import type { TransactionScope } from '@cadenway/nest-common/database';
import { Injectable } from '@nestjs/common';
import { and, eq, lte, sql } from 'drizzle-orm';
import { z } from 'zod';
import type { SecurityEmailContent } from '../../../../../application/models/security-email/security-email-content.model.js';
import type { SecurityEmailDelivery } from '../../../../../application/models/security-email/security-email-delivery.model.js';
import type { SecurityEmailDeliveryDraft } from '../../../../../application/models/security-email/security-email-delivery-draft.model.js';
import type { SecurityEmailDeliveryStatus } from '../../../../../application/models/security-email/security-email-delivery-status.model.js';
import type { SecurityEmailDetails } from '../../../../../application/models/security-email/security-email-details.model.js';
import type { SecurityEmailDeliveries } from '../../../../../application/ports/outbound/persistence/security-email/security-email-deliveries.port.js';
import { ResetLinkToken } from '../../../../../domain/value-objects/security-email/reset-link-token.value-object.js';
import type { SecurityEmailSkipReason } from '../../../../../domain/value-objects/security-email/security-email-skip-reason.value-object.js';
import type { SecurityEmailTemplate } from '../../../../../domain/value-objects/security-email/security-email-template.value-object.js';
import { SendWindow } from '../../../../../domain/value-objects/security-email/send-window.value-object.js';

/**
 * Constant TEMPLATES
 *
 * @description
 * The values of `security_email_deliveries.template`, as its check constraint allows them.
 *
 * @type {readonly SecurityEmailTemplate[]}
 */
const TEMPLATES: readonly SecurityEmailTemplate[] = [
  'password-reset',
  'password-changed',
  'email-changed',
  'new-device',
  'deletion-scheduled',
  'deletion-cancelled',
];

/**
 * Constant STATUSES
 *
 * @description
 * The values of `security_email_deliveries.status`, as its check constraint allows them.
 *
 * @type {readonly SecurityEmailDeliveryStatus[]}
 */
const STATUSES: readonly SecurityEmailDeliveryStatus[] = ['queued', 'sent', 'skipped', 'failed'];

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
 * Constant clientRecord
 *
 * @description
 * The browser as `details` stores it.
 *
 * @type {z.ZodObject}
 */
const clientRecord = z.object({
  deviceType: z.string(),
  browser: z.string().nullable(),
  os: z.string().nullable(),
  osVersion: z.string().nullable(),
  ipAddress: z.string().nullable(),
});

/**
 * Constant detailsRecord
 *
 * @description
 * The column `pending_security_emails.details`, as this repository writes it: the details of the
 * template without the reset token, which has a column of its own, and with the deletion date as
 * an ISO 8601 string. Read back through this schema, so a row a later version wrote differently
 * fails loudly instead of rendering a wrong e-mail.
 *
 * @type {z.ZodDiscriminatedUnion}
 */
const detailsRecord = z.discriminatedUnion('template', [
  z.object({ template: z.literal('password-reset'), client: clientRecord }),
  z.object({
    template: z.literal('password-changed'),
    method: z.enum(['change', 'reset']),
    closedSessionCount: z.int().nonnegative(),
    client: clientRecord,
  }),
  z.object({ template: z.literal('email-changed'), newEmail: z.string(), client: clientRecord }),
  z.object({ template: z.literal('new-device'), client: clientRecord }),
  z.object({ template: z.literal('deletion-scheduled'), deleteAt: z.iso.datetime() }),
  z.object({ template: z.literal('deletion-cancelled'), client: clientRecord }),
]);

/**
 * Type DetailsRecord
 *
 * @description
 * A value of the column `details`.
 *
 * @type {z.infer<typeof detailsRecord>}
 */
type DetailsRecord = z.infer<typeof detailsRecord>;

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
    throw new Error(
      `security_email_deliveries.${column} holds a value this version does not know.`,
    );
  }
  return found;
}

/**
 * Function toRecord
 *
 * @description
 * Splits the details of an e-mail into the value of `details` and the reset token, so that the
 * token never enters the JSON column.
 *
 * @param {SecurityEmailDetails} details - The details.
 * @returns {{ readonly record: DetailsRecord; readonly token: string | null }} The two columns.
 */
function toRecord(details: SecurityEmailDetails): {
  readonly record: DetailsRecord;
  readonly token: string | null;
} {
  switch (details.template) {
    case 'password-reset':
      return {
        record: { template: details.template, client: details.client },
        token: details.token.reveal(),
      };
    case 'deletion-scheduled':
      return {
        record: { template: details.template, deleteAt: details.deleteAt.toISOString() },
        token: null,
      };
    case 'password-changed':
    case 'email-changed':
    case 'new-device':
    case 'deletion-cancelled':
      return { record: details, token: null };
  }
}

/**
 * Function toDetails
 *
 * @description
 * Rebuilds the details of an e-mail from its two columns.
 *
 * @param {unknown} value - The value of `details`.
 * @param {string | null} token - The value of `token`.
 * @returns {SecurityEmailDetails} The details.
 * @throws {Error} When the column does not hold details this version writes, or a reset e-mail
 * lost its token.
 */
function toDetails(value: unknown, token: string | null): SecurityEmailDetails {
  const record: DetailsRecord = detailsRecord.parse(value);
  switch (record.template) {
    case 'password-reset':
      if (token === null) {
        throw new Error('pending_security_emails holds a reset e-mail without its token.');
      }
      return { template: record.template, client: record.client, token: ResetLinkToken.of(token) };
    case 'deletion-scheduled':
      return { template: record.template, deleteAt: new Date(record.deleteAt) };
    case 'password-changed':
    case 'email-changed':
    case 'new-device':
    case 'deletion-cancelled':
      return record;
  }
}

/**
 * Class DrizzleSecurityEmailDeliveryRepository
 *
 * @description
 * `SecurityEmailDeliveries` on the tables `security_email_deliveries` (the send log) and
 * `pending_security_emails` (the recipient, the details and the reset token of a `queued`
 * delivery) of this service's own database. Every call runs in a transaction of the system runner
 * of the kit, and joins the one already open around it: the transaction of
 * `SecurityEmailUnitOfWork`, or the one in which the deduplicator of the kit handles an event. The
 * tables admit the system runner only.
 *
 * A change of state applies to a `queued` delivery only and deletes its pending content in the same
 * transaction, so the address, the device and the token never outlive the e-mail.
 */
@Injectable()
export class DrizzleSecurityEmailDeliveryRepository implements SecurityEmailDeliveries {
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
   * @param {SecurityEmailDeliveryDraft} draft - The delivery.
   * @param {SecurityEmailContent | null} content - The recipient and the details, or `null`.
   * @returns {Promise<string | null>} The id of the new delivery, or `null` for a known event.
   */
  public async record(
    draft: SecurityEmailDeliveryDraft,
    content: SecurityEmailContent | null,
  ): Promise<string | null> {
    return this.system.run(async (tx: TransactionScope): Promise<string | null> => {
      const inserted: readonly { readonly id: string }[] = await tx.db
        .insert(securityEmailDeliveries)
        .values({
          eventId: draft.eventId,
          userId: draft.userId,
          template: draft.template,
          language: draft.language,
          occurredAt: draft.window.occurredAt,
          sendBefore: draft.window.sendBefore,
          status: draft.skipReason === null ? 'queued' : 'skipped',
          skipReason: draft.skipReason,
        })
        .onConflictDoNothing({ target: securityEmailDeliveries.eventId })
        .returning({ id: securityEmailDeliveries.id });
      const id: string | undefined = inserted[0]?.id;
      if (id === undefined) {
        return null;
      }
      if (content !== null) {
        const { record, token }: { readonly record: DetailsRecord; readonly token: string | null } =
          toRecord(content.details);
        await tx.db.insert(pendingSecurityEmails).values({
          deliveryId: id,
          recipientEmail: content.recipientEmail,
          recipientName: content.recipientName,
          timeZone: content.timeZone,
          details: record,
          token,
          sendBefore: draft.window.sendBefore,
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
   * @returns {Promise<SecurityEmailDelivery | null>} The delivery, or `null`.
   */
  public async find(deliveryId: string): Promise<SecurityEmailDelivery | null> {
    return this.system.run(async (tx: TransactionScope): Promise<SecurityEmailDelivery | null> => {
      const rows: readonly {
        readonly id: string;
        readonly template: string;
        readonly status: string;
        readonly occurredAt: Date;
        readonly sendBefore: Date;
        readonly recipientEmail: string | null;
        readonly recipientName: string | null;
        readonly timeZone: string | null;
        readonly details: unknown;
        readonly token: string | null;
      }[] = await tx.db
        .select({
          id: securityEmailDeliveries.id,
          template: securityEmailDeliveries.template,
          status: securityEmailDeliveries.status,
          occurredAt: securityEmailDeliveries.occurredAt,
          sendBefore: securityEmailDeliveries.sendBefore,
          recipientEmail: pendingSecurityEmails.recipientEmail,
          recipientName: pendingSecurityEmails.recipientName,
          timeZone: pendingSecurityEmails.timeZone,
          details: pendingSecurityEmails.details,
          token: pendingSecurityEmails.token,
        })
        .from(securityEmailDeliveries)
        .leftJoin(
          pendingSecurityEmails,
          eq(pendingSecurityEmails.deliveryId, securityEmailDeliveries.id),
        )
        .where(eq(securityEmailDeliveries.id, deliveryId))
        .limit(1);
      const row: (typeof rows)[number] | undefined = rows[0];
      if (row === undefined) {
        return null;
      }
      return {
        id: row.id,
        template: oneOf(TEMPLATES, row.template, 'template'),
        status: oneOf(STATUSES, row.status, 'status'),
        window: SendWindow.between(row.occurredAt, row.sendBefore),
        content:
          row.recipientEmail === null || row.recipientName === null || row.timeZone === null
            ? null
            : {
                recipientEmail: row.recipientEmail,
                recipientName: row.recipientName,
                timeZone: row.timeZone,
                details: toDetails(row.details, row.token),
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
   * @param {SecurityEmailSkipReason} reason - Why it is not sent.
   * @returns {Promise<void>} Settles once committed.
   */
  public async markSkipped(deliveryId: string, reason: SecurityEmailSkipReason): Promise<void> {
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
   * Settles up to `EXPIRE_BATCH` `queued` deliveries whose window closed, oldest first, through the
   * partial index on their `send_before`; rows another transaction holds (an attempt marking them)
   * are skipped (`for update skip locked`) and left to that attempt or to the next sweep. Then
   * deletes every pending content whose window closed, through the index on its `send_before`.
   *
   * @param {Date} now - The current instant.
   * @returns {Promise<number>} How many deliveries were settled.
   */
  public async expireStale(now: Date): Promise<number> {
    return this.system.run(async (tx: TransactionScope): Promise<number> => {
      const settled: { readonly rows: unknown[] } = await tx.client.query(
        `with stale as (
           select id from security_email_deliveries
            where status = 'queued' and send_before <= $1
            order by send_before
            limit $2
            for update skip locked
         )
         update security_email_deliveries as delivery
            set status = 'skipped', skip_reason = 'expired', version = delivery.version + 1,
                updated_at = now()
           from stale
          where delivery.id = stale.id
         returning delivery.id`,
        [now, EXPIRE_BATCH],
      );
      await tx.db.delete(pendingSecurityEmails).where(lte(pendingSecurityEmails.sendBefore, now));
      return settled.rows.length;
    });
  }

  /**
   * Method settle
   *
   * @description
   * Moves a `queued` delivery to its final state, raising its version, and deletes its content, in
   * one transaction. A delivery already settled keeps its state; its content is deleted anyway.
   *
   * @param {string} deliveryId - Id of the delivery.
   * @param {Exclude<SecurityEmailDeliveryStatus, 'queued'>} status - The final state.
   * @param {SecurityEmailSkipReason | null} skipReason - The reason of a `skipped` delivery, else
   * `null`.
   * @returns {Promise<void>} Settles once committed.
   */
  private async settle(
    deliveryId: string,
    status: Exclude<SecurityEmailDeliveryStatus, 'queued'>,
    skipReason: SecurityEmailSkipReason | null,
  ): Promise<void> {
    await this.system.run(async (tx: TransactionScope): Promise<void> => {
      await tx.db
        .update(securityEmailDeliveries)
        .set({
          status,
          skipReason,
          sentAt: status === 'sent' ? sql`now()` : null,
          version: sql`${securityEmailDeliveries.version} + 1`,
          updatedAt: sql`now()`,
        })
        .where(
          and(
            eq(securityEmailDeliveries.id, deliveryId),
            eq(securityEmailDeliveries.status, 'queued'),
          ),
        );
      await tx.db
        .delete(pendingSecurityEmails)
        .where(eq(pendingSecurityEmails.deliveryId, deliveryId));
    });
  }
  // #endregion
}
