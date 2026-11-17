import securityEmailDeliveries from './security-email-deliveries.schema.js';
import { sql } from 'drizzle-orm';
import type { SQL } from 'drizzle-orm';
import { check, index, jsonb, pgPolicy, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';

/**
 * Constant systemAccess
 *
 * @description
 * Predicate of the policy of the table: its rows exist for the system runner of the kit only, so a
 * route that serves an organization can never read an address, a device or a reset token.
 *
 * @type {SQL}
 */
const systemAccess: SQL = sql`current_setting('app.system_access', true) = 'on'`;

/**
 * What only the e-mail itself shows, for a `queued` security delivery (`pendingSecurityEmails`):
 * the address and the name of the recipient, the time zone of the dates, the details of the
 * template (`details`: the device and the IP address, a new address, a deletion date) and, for the
 * reset e-mail only, the secret of the link (`token`), in a column of its own so that `details`
 * never holds a secret. A row lives from the event until its e-mail is sent, skipped or failed, and
 * not much longer than its window: the sweep deletes the rows whose window closed (`send_before`,
 * indexed). Deleted with its delivery (`on delete cascade`). Row-level security is forced by the
 * migration, which drizzle-kit does not generate.
 */
export default pgTable(
  'pending_security_emails',
  {
    deliveryId: uuid('delivery_id')
      .primaryKey()
      .references(() => securityEmailDeliveries.id, { onDelete: 'cascade' }),
    recipientEmail: text('recipient_email').notNull(),
    recipientName: text('recipient_name').notNull(),
    timeZone: text('time_zone').notNull(),
    details: jsonb('details').notNull(),
    token: text('token'),
    sendBefore: timestamp('send_before', { withTimezone: true }).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('pending_security_emails_send_before_index').on(table.sendBefore),
    check(
      'pending_security_emails_token_check',
      sql`${table.token} is null or ${table.token} ~ '^[A-Za-z0-9_-]{32,128}$'`,
    ),
    pgPolicy('pending_security_emails_system_access', {
      as: 'permissive',
      for: 'all',
      using: systemAccess,
      withCheck: systemAccess,
    }),
  ],
);
