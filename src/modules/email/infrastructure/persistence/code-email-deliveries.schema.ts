import { sql } from 'drizzle-orm';
import type { SQL } from 'drizzle-orm';
import {
  check,
  index,
  integer,
  pgPolicy,
  pgTable,
  text,
  timestamp,
  unique,
  uuid,
} from 'drizzle-orm/pg-core';

/**
 * Constant systemAccess
 *
 * @description
 * Predicate of the policy of the table: its rows exist for the system runner of the kit only
 * (`app.system_access = 'on'`). A code e-mail belongs to an account, not to an organization, so the
 * table carries no `organization_id`; the policy keeps it out of every tenant transaction.
 *
 * @type {SQL}
 */
const systemAccess: SQL = sql`current_setting('app.system_access', true) = 'on'`;

/**
 * The send log of the e-mails that carry a single-use code (`codeEmailDeliveries`): one row per
 * `one-time-code.issued.v1` event (unique `event_id`), naming the event, the code and the account
 * by their ids, with the purpose, the validity of the code, where the e-mail stands and when it
 * was sent. It never holds the code nor the address: those wait in `pending_code_emails`.
 *
 * `status` and `skip_reason` follow `CodeEmailDeliveryStatus` and `CodeEmailSkipReason` of the
 * application layer; a `skip_reason` exists exactly when the row is `skipped`, a `sent_at` exactly
 * when it is `sent`. Its id is the payload and the idempotency key of the job that sends the
 * e-mail. Row-level security is forced by the migration, which drizzle-kit does not generate.
 */
export default pgTable(
  'code_email_deliveries',
  {
    id: uuid('id')
      .primaryKey()
      .default(sql`uuidv7()`),
    eventId: uuid('event_id').notNull(),
    codeId: uuid('code_id').notNull(),
    userId: uuid('user_id').notNull(),
    purpose: text('purpose').notNull(),
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
    unique('code_email_deliveries_event_id_unique').on(table.eventId),
    // The sweep reads the `queued` rows whose code expired, oldest first.
    index('code_email_deliveries_queued_expires_at_index')
      .on(table.expiresAt)
      .where(sql`${table.status} = 'queued'`),
    check(
      'code_email_deliveries_purpose_check',
      sql`${table.purpose} in ('email-verification', 'sign-in', 'email-change')`,
    ),
    check(
      'code_email_deliveries_status_check',
      sql`${table.status} in ('queued', 'sent', 'skipped', 'failed')`,
    ),
    check(
      'code_email_deliveries_skip_reason_check',
      sql`(${table.status} = 'skipped') = (${table.skipReason} is not null) and (${table.skipReason} is null or ${table.skipReason} in ('expired', 'purpose-not-supported'))`,
    ),
    check(
      'code_email_deliveries_sent_at_check',
      sql`(${table.status} = 'sent') = (${table.sentAt} is not null)`,
    ),
    check('code_email_deliveries_validity_check', sql`${table.expiresAt} > ${table.issuedAt}`),
    pgPolicy('code_email_deliveries_system_access', {
      as: 'permissive',
      for: 'all',
      using: systemAccess,
      withCheck: systemAccess,
    }),
  ],
);
