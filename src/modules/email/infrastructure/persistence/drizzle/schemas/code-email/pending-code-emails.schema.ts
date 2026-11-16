import codeEmailDeliveries from './code-email-deliveries.schema.js';
import { sql } from 'drizzle-orm';
import type { SQL } from 'drizzle-orm';
import { check, index, pgPolicy, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';

/**
 * Constant systemAccess
 *
 * @description
 * Predicate of the policy of the table: its rows exist for the system runner of the kit only, so a
 * route that serves an organization can never read a code or an address.
 *
 * @type {SQL}
 */
const systemAccess: SQL = sql`current_setting('app.system_access', true) = 'on'`;

/**
 * What only the e-mail itself shows, for a `queued` delivery (`pendingCodeEmails`): the code, the
 * address and the name of the recipient. A row lives from the event until its e-mail is sent,
 * skipped or failed, and not much longer than its code: the send job deletes the rows whose code
 * expired (`expires_at`, indexed). Deleted with its delivery (`on delete cascade`). Row-level
 * security is forced by the migration, which drizzle-kit does not generate.
 */
export default pgTable(
  'pending_code_emails',
  {
    deliveryId: uuid('delivery_id')
      .primaryKey()
      .references(() => codeEmailDeliveries.id, { onDelete: 'cascade' }),
    code: text('code').notNull(),
    recipientEmail: text('recipient_email').notNull(),
    recipientName: text('recipient_name').notNull(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('pending_code_emails_expires_at_index').on(table.expiresAt),
    check('pending_code_emails_code_check', sql`${table.code} ~ '^[0-9]{6}$'`),
    pgPolicy('pending_code_emails_system_access', {
      as: 'permissive',
      for: 'all',
      using: systemAccess,
      withCheck: systemAccess,
    }),
  ],
);
