import { organizationPolicy } from '@cadenway/nest-common/database';
import { sql } from 'drizzle-orm';
import { check, index, integer, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import invitationEmailDeliveries from './invitation-email-deliveries.schema.js';

/**
 * What only the e-mail itself shows, for a `queued` invitation delivery
 * (`pendingInvitationEmails`): the invited address, the names of the inviter and of the
 * organization, and the member count of the header. A row lives from the event until its e-mail
 * is sent, skipped, superseded or failed, and never more than the hour of a sweep after its
 * invitation expired (`expires_at`, indexed). Deleted with its delivery (`on delete cascade`).
 * Owned by the organization of its delivery, behind the organization policy of the kit; row-level
 * security is forced by the migration.
 */
export default pgTable(
  'pending_invitation_emails',
  {
    deliveryId: uuid('delivery_id')
      .primaryKey()
      .references(() => invitationEmailDeliveries.id, { onDelete: 'cascade' }),
    organizationId: uuid('organization_id').notNull(),
    recipientEmail: text('recipient_email').notNull(),
    inviterName: text('inviter_name').notNull(),
    organizationName: text('organization_name').notNull(),
    memberCount: integer('member_count').notNull(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('pending_invitation_emails_expires_at_index').on(table.expiresAt),
    check('pending_invitation_emails_member_count_check', sql`${table.memberCount} >= 1`),
    organizationPolicy('pending_invitation_emails_organization_isolation'),
  ],
);
