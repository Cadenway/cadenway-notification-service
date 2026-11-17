import { organizationPolicy } from '@cadenway/nest-common/database';
import { sql } from 'drizzle-orm';
import { check, index, integer, pgTable, text, timestamp, unique, uuid } from 'drizzle-orm/pg-core';

/**
 * The send log of the invitation e-mails (`invitationEmailDeliveries`): one row per
 * `invitation.issued.v1` event (unique `event_id` in its organization), naming the event and the
 * invitation by their ids, with the version of the invitation, the proposed role, its validity,
 * where the e-mail stands and when it was sent. It never holds the address nor a name: those wait
 * in `pending_invitation_emails`.
 *
 * Owned by the organization of the event (`organization_id`, first in the tenant indexes), behind
 * the organization policy of the kit; row-level security is forced by the migration, which
 * drizzle-kit does not generate. `status` and `skip_reason` follow
 * `InvitationEmailDeliveryStatus` and `InvitationEmailSkipReason` of the application layer; a
 * `skip_reason` exists exactly when the row is `skipped`, a `sent_at` exactly when it is `sent`.
 * Its id is the payload and the idempotency key of the job that sends the e-mail.
 */
export default pgTable(
  'invitation_email_deliveries',
  {
    id: uuid('id')
      .primaryKey()
      .default(sql`uuidv7()`),
    organizationId: uuid('organization_id').notNull(),
    eventId: uuid('event_id').notNull(),
    invitationId: uuid('invitation_id').notNull(),
    invitationVersion: integer('invitation_version').notNull(),
    role: text('role').notNull(),
    language: text('language').notNull(),
    issuedAt: timestamp('issued_at', { withTimezone: true }).notNull(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    status: text('status').notNull(),
    skipReason: text('skip_reason'),
    sentAt: timestamp('sent_at', { withTimezone: true }),
    version: integer('version').notNull().default(1),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    unique('invitation_email_deliveries_organization_id_event_id_unique').on(
      table.organizationId,
      table.eventId,
    ),
    // A resend supersedes the deliveries of the same invitation still waiting.
    index('invitation_email_deliveries_invitation_index').on(
      table.organizationId,
      table.invitationId,
    ),
    // The hourly sweep reads the `queued` rows whose invitation expired, in every organization.
    index('invitation_email_deliveries_queued_expires_at_index')
      .on(table.expiresAt)
      .where(sql`${table.status} = 'queued'`),
    check(
      'invitation_email_deliveries_invitation_version_check',
      sql`${table.invitationVersion} >= 1`,
    ),
    check(
      'invitation_email_deliveries_role_check',
      sql`${table.role} in ('admin', 'member', 'guest')`,
    ),
    check(
      'invitation_email_deliveries_status_check',
      sql`${table.status} in ('queued', 'sent', 'skipped', 'failed')`,
    ),
    check(
      'invitation_email_deliveries_skip_reason_check',
      sql`(${table.status} = 'skipped') = (${table.skipReason} is not null) and (${table.skipReason} is null or ${table.skipReason} in ('expired', 'superseded'))`,
    ),
    check(
      'invitation_email_deliveries_sent_at_check',
      sql`(${table.status} = 'sent') = (${table.sentAt} is not null)`,
    ),
    // `InvitationValidity`: after the sending, within 8 days.
    check(
      'invitation_email_deliveries_validity_check',
      sql`${table.expiresAt} > ${table.issuedAt} and ${table.expiresAt} <= ${table.issuedAt} + interval '8 days'`,
    ),
    organizationPolicy('invitation_email_deliveries_organization_isolation'),
  ],
);
