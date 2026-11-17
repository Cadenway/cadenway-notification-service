import { SystemTransactionRunner, TenantTransactionRunner } from '@cadenway/nest-common/database';
import type { TransactionScope } from '@cadenway/nest-common/database';
import { Injectable } from '@nestjs/common';
import { and, eq, inArray, lt, lte, sql } from 'drizzle-orm';
import type { InvitationEmailContent } from '../../../../../application/models/invitation-email/invitation-email-content.model.js';
import type { InvitationEmailDeliveryDraft } from '../../../../../application/models/invitation-email/invitation-email-delivery-draft.model.js';
import type { InvitationEmailDeliveryStatus } from '../../../../../application/models/invitation-email/invitation-email-delivery-status.model.js';
import type { InvitationEmailDelivery } from '../../../../../application/models/invitation-email/invitation-email-delivery.model.js';
import type { InvitationEmailDeliveries } from '../../../../../application/ports/outbound/persistence/invitation-email/invitation-email-deliveries.port.js';
import type { InvitationEmailSkipReason } from '../../../../../domain/value-objects/invitation-email/invitation-email-skip-reason.value-object.js';
import type { InvitationRole } from '../../../../../domain/value-objects/invitation-email/invitation-role.value-object.js';
import { InvitationValidity } from '../../../../../domain/value-objects/invitation-email/invitation-validity.value-object.js';
import invitationEmailDeliveries from '../../schemas/invitation-email/invitation-email-deliveries.schema.js';
import pendingInvitationEmails from '../../schemas/invitation-email/pending-invitation-emails.schema.js';

/**
 * Constant ROLES
 *
 * @description
 * The values of `invitation_email_deliveries.role`, as its check constraint allows them.
 *
 * @type {readonly InvitationRole[]}
 */
const ROLES: readonly InvitationRole[] = ['admin', 'member', 'guest'];

/**
 * Constant STATUSES
 *
 * @description
 * The values of `invitation_email_deliveries.status`, as its check constraint allows them.
 *
 * @type {readonly InvitationEmailDeliveryStatus[]}
 */
const STATUSES: readonly InvitationEmailDeliveryStatus[] = ['queued', 'sent', 'skipped', 'failed'];

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
    throw new Error(
      `invitation_email_deliveries.${column} holds a value this version does not know.`,
    );
  }
  return found;
}

/**
 * Function organizationOf
 *
 * @description
 * The organization of a tenant transaction, which owns every row this repository writes.
 *
 * @param {TransactionScope} tx - The transaction.
 * @returns {string} Its organization.
 * @throws {Error} When the transaction is not a tenant one, a programming error.
 */
function organizationOf(tx: TransactionScope): string {
  if (tx.organizationId === null) {
    throw new Error('An invitation e-mail is written in a tenant transaction of its organization.');
  }
  return tx.organizationId;
}

/**
 * Class DrizzleInvitationEmailDeliveryRepository
 *
 * @description
 * `InvitationEmailDeliveries` on the tables `invitation_email_deliveries` (the send log) and
 * `pending_invitation_emails` (the address and the names of a `queued` delivery) of this
 * service's own database. Every call but `expireStale` runs in a tenant transaction of the
 * organization of the current context, and joins the one already open around it: the transaction
 * of `InvitationEmailUnitOfWork`, or the one in which the deduplicator of the kit handles the
 * event. Every statement filters on that organization, behind the organization policy of the
 * tables. `expireStale` runs in a system transaction and crosses organizations, a bounded
 * exception recorded in `MODULE.md`.
 *
 * A change of state applies to a `queued` delivery only and deletes its pending content in the
 * same transaction, so the address never outlives the e-mail.
 */
@Injectable()
export class DrizzleInvitationEmailDeliveryRepository implements InvitationEmailDeliveries {
  // #region Properties
  /**
   * Property tenant
   *
   * @description
   * The tenant transaction runner of the kit.
   *
   * @type {TenantTransactionRunner}
   * @readonly
   */
  private readonly tenant: TenantTransactionRunner;

  /**
   * Property system
   *
   * @description
   * The system transaction runner of the kit, for the sweep only.
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
   * Receives the transaction runners of `DatabaseModule`.
   *
   * @param {TenantTransactionRunner} tenant - The tenant transaction runner.
   * @param {SystemTransactionRunner} system - The system transaction runner.
   * @constructor
   */
  public constructor(tenant: TenantTransactionRunner, system: SystemTransactionRunner) {
    this.tenant = tenant;
    this.system = system;
  }
  // #endregion

  // #region Methods
  /**
   * Method record
   *
   * @description
   * Inserts the delivery in the organization of the transaction, unless one exists for the same
   * event (`on conflict do nothing` on the unique `(organization_id, event_id)`), then its content
   * when there is one.
   *
   * @param {InvitationEmailDeliveryDraft} draft - The delivery.
   * @param {InvitationEmailContent | null} content - The address and the names, or `null`.
   * @returns {Promise<string | null>} The id of the new delivery, or `null` for a known event.
   */
  public async record(
    draft: InvitationEmailDeliveryDraft,
    content: InvitationEmailContent | null,
  ): Promise<string | null> {
    return this.tenant.run(async (tx: TransactionScope): Promise<string | null> => {
      const organizationId: string = organizationOf(tx);
      const inserted: readonly { readonly id: string }[] = await tx.db
        .insert(invitationEmailDeliveries)
        .values({
          organizationId,
          eventId: draft.eventId,
          invitationId: draft.invitationId,
          invitationVersion: draft.invitationVersion,
          role: draft.role,
          language: draft.language,
          issuedAt: draft.validity.issuedAt,
          expiresAt: draft.validity.expiresAt,
          status: draft.skipReason === null ? 'queued' : 'skipped',
          skipReason: draft.skipReason,
        })
        .onConflictDoNothing({
          target: [invitationEmailDeliveries.organizationId, invitationEmailDeliveries.eventId],
        })
        .returning({ id: invitationEmailDeliveries.id });
      const id: string | undefined = inserted[0]?.id;
      if (id === undefined) {
        return null;
      }
      if (content !== null) {
        await tx.db.insert(pendingInvitationEmails).values({
          deliveryId: id,
          organizationId,
          recipientEmail: content.recipientEmail,
          inviterName: content.inviterName,
          organizationName: content.organizationName,
          memberCount: content.memberCount,
          expiresAt: draft.validity.expiresAt,
        });
      }
      return id;
    });
  }

  /**
   * Method supersede
   *
   * @description
   * Marks `skipped` for `superseded` the `queued` deliveries of the invitation for an older
   * version, through the index on `(organization_id, invitation_id)`, and deletes their contents.
   *
   * @param {string} invitationId - Id of the invitation.
   * @param {number} version - The latest version received.
   * @returns {Promise<number>} How many deliveries were superseded.
   */
  public async supersede(invitationId: string, version: number): Promise<number> {
    return this.tenant.run(async (tx: TransactionScope): Promise<number> => {
      const organizationId: string = organizationOf(tx);
      const superseded: readonly { readonly id: string }[] = await tx.db
        .update(invitationEmailDeliveries)
        .set({
          status: 'skipped',
          skipReason: 'superseded',
          version: sql`${invitationEmailDeliveries.version} + 1`,
          updatedAt: sql`now()`,
        })
        .where(
          and(
            eq(invitationEmailDeliveries.organizationId, organizationId),
            eq(invitationEmailDeliveries.invitationId, invitationId),
            lt(invitationEmailDeliveries.invitationVersion, version),
            eq(invitationEmailDeliveries.status, 'queued'),
          ),
        )
        .returning({ id: invitationEmailDeliveries.id });
      const ids: readonly string[] = superseded.map((row) => row.id);
      if (ids.length > 0) {
        await tx.db
          .delete(pendingInvitationEmails)
          .where(
            and(
              eq(pendingInvitationEmails.organizationId, organizationId),
              inArray(pendingInvitationEmails.deliveryId, [...ids]),
            ),
          );
      }
      return ids.length;
    });
  }

  /**
   * Method find
   *
   * @description
   * Reads a delivery of the organization of the transaction and, when it still exists, its
   * content.
   *
   * @param {string} deliveryId - Id of the delivery.
   * @returns {Promise<InvitationEmailDelivery | null>} The delivery, or `null`.
   */
  public async find(deliveryId: string): Promise<InvitationEmailDelivery | null> {
    return this.tenant.run(
      async (tx: TransactionScope): Promise<InvitationEmailDelivery | null> => {
        const organizationId: string = organizationOf(tx);
        const rows: readonly {
          readonly id: string;
          readonly invitationId: string;
          readonly role: string;
          readonly status: string;
          readonly issuedAt: Date;
          readonly expiresAt: Date;
          readonly recipientEmail: string | null;
          readonly inviterName: string | null;
          readonly organizationName: string | null;
          readonly memberCount: number | null;
        }[] = await tx.db
          .select({
            id: invitationEmailDeliveries.id,
            invitationId: invitationEmailDeliveries.invitationId,
            role: invitationEmailDeliveries.role,
            status: invitationEmailDeliveries.status,
            issuedAt: invitationEmailDeliveries.issuedAt,
            expiresAt: invitationEmailDeliveries.expiresAt,
            recipientEmail: pendingInvitationEmails.recipientEmail,
            inviterName: pendingInvitationEmails.inviterName,
            organizationName: pendingInvitationEmails.organizationName,
            memberCount: pendingInvitationEmails.memberCount,
          })
          .from(invitationEmailDeliveries)
          .leftJoin(
            pendingInvitationEmails,
            and(
              eq(pendingInvitationEmails.organizationId, invitationEmailDeliveries.organizationId),
              eq(pendingInvitationEmails.deliveryId, invitationEmailDeliveries.id),
            ),
          )
          .where(
            and(
              eq(invitationEmailDeliveries.organizationId, organizationId),
              eq(invitationEmailDeliveries.id, deliveryId),
            ),
          )
          .limit(1);
        const row: (typeof rows)[number] | undefined = rows[0];
        if (row === undefined) {
          return null;
        }
        return {
          id: row.id,
          invitationId: row.invitationId,
          role: oneOf(ROLES, row.role, 'role'),
          status: oneOf(STATUSES, row.status, 'status'),
          validity: InvitationValidity.between(row.issuedAt, row.expiresAt),
          content:
            row.recipientEmail === null ||
            row.inviterName === null ||
            row.organizationName === null ||
            row.memberCount === null
              ? null
              : {
                  recipientEmail: row.recipientEmail,
                  inviterName: row.inviterName,
                  organizationName: row.organizationName,
                  memberCount: row.memberCount,
                },
        };
      },
    );
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
   * @param {InvitationEmailSkipReason} reason - Why it is not sent.
   * @returns {Promise<void>} Settles once committed.
   */
  public async markSkipped(deliveryId: string, reason: InvitationEmailSkipReason): Promise<void> {
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
   * In a system transaction, across organizations: settles up to `EXPIRE_BATCH` `queued`
   * deliveries whose invitation expired, oldest first, through the partial index on their
   * `expires_at`; rows another transaction holds (an attempt marking them) are skipped
   * (`for update skip locked`) and left to that attempt or to the next sweep. Then deletes every
   * pending content whose invitation expired, through the index on its `expires_at`.
   *
   * @param {Date} now - The current instant.
   * @returns {Promise<number>} How many deliveries were settled.
   */
  public async expireStale(now: Date): Promise<number> {
    return this.system.run(async (tx: TransactionScope): Promise<number> => {
      const settled: { readonly rows: unknown[] } = await tx.client.query(
        `with stale as (
           select id from invitation_email_deliveries
            where status = 'queued' and expires_at <= $1
            order by expires_at
            limit $2
            for update skip locked
         )
         update invitation_email_deliveries as delivery
            set status = 'skipped', skip_reason = 'expired', version = delivery.version + 1,
                updated_at = now()
           from stale
          where delivery.id = stale.id
         returning delivery.id`,
        [now, EXPIRE_BATCH],
      );
      await tx.db
        .delete(pendingInvitationEmails)
        .where(lte(pendingInvitationEmails.expiresAt, now));
      return settled.rows.length;
    });
  }

  /**
   * Method settle
   *
   * @description
   * Moves a `queued` delivery of the organization to its final state, raising its version, and
   * deletes its content, in one transaction. A delivery already settled keeps its state; its
   * content is deleted anyway.
   *
   * @param {string} deliveryId - Id of the delivery.
   * @param {Exclude<InvitationEmailDeliveryStatus, 'queued'>} status - The final state.
   * @param {InvitationEmailSkipReason | null} skipReason - The reason of a `skipped` delivery,
   * else `null`.
   * @returns {Promise<void>} Settles once committed.
   */
  private async settle(
    deliveryId: string,
    status: Exclude<InvitationEmailDeliveryStatus, 'queued'>,
    skipReason: InvitationEmailSkipReason | null,
  ): Promise<void> {
    await this.tenant.run(async (tx: TransactionScope): Promise<void> => {
      const organizationId: string = organizationOf(tx);
      await tx.db
        .update(invitationEmailDeliveries)
        .set({
          status,
          skipReason,
          sentAt: status === 'sent' ? sql`now()` : null,
          version: sql`${invitationEmailDeliveries.version} + 1`,
          updatedAt: sql`now()`,
        })
        .where(
          and(
            eq(invitationEmailDeliveries.organizationId, organizationId),
            eq(invitationEmailDeliveries.id, deliveryId),
            eq(invitationEmailDeliveries.status, 'queued'),
          ),
        );
      await tx.db
        .delete(pendingInvitationEmails)
        .where(
          and(
            eq(pendingInvitationEmails.organizationId, organizationId),
            eq(pendingInvitationEmails.deliveryId, deliveryId),
          ),
        );
    });
  }
  // #endregion
}
