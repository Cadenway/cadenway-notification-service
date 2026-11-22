import { sql } from 'drizzle-orm';
import { check, index, json, pgPolicy, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';

const systemAccess = sql`current_setting('app.system_access', true) = 'on'`;

/** Contact content retained for the durable support email delivery. */
export const siteContactSubmissions = pgTable(
  'site_contact_submissions',
  {
    id: uuid('id')
      .primaryKey()
      .default(sql`uuidv7()`),
    replyTo: text('reply_to').notNull(),
    subject: text('subject').notNull(),
    // JSON keeps escaped code units from the form even when PostgreSQL text cannot represent them.
    message: json('message').$type<{ readonly text: string }>().notNull(),
    status: text('status').notNull().default('pending'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    check(
      'site_contact_submissions_subject_check',
      sql`${table.subject} in ('login', 'mfa', 'org', 'data', 'other')`,
    ),
    check(
      'site_contact_submissions_status_check',
      sql`${table.status} in ('pending', 'sent', 'failed')`,
    ),
    index('site_contact_submissions_pending_updated_index')
      .on(table.updatedAt, table.id)
      .where(sql`${table.status} = 'pending'`),
    index('site_contact_submissions_sent_expiry_index')
      .on(table.updatedAt, table.id)
      .where(sql`${table.status} = 'sent'`),
    index('site_contact_submissions_undelivered_expiry_index')
      .on(table.createdAt, table.id)
      .where(sql`${table.status} in ('pending', 'failed')`),
    pgPolicy('site_contact_submissions_system_access', {
      for: 'all',
      using: systemAccess,
      withCheck: systemAccess,
    }),
  ],
).enableRLS();

/** Binds a hashed retry key to its accepted message until the receipt expires. */
export const siteContactReceipts = pgTable(
  'site_contact_receipts',
  {
    keyHash: text('key_hash').primaryKey(),
    fingerprint: text('fingerprint').notNull(),
    submissionId: uuid('submission_id')
      .notNull()
      .references(() => siteContactSubmissions.id),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('site_contact_receipts_expiration_index').on(table.expiresAt),
    index('site_contact_receipts_submission_index').on(table.submissionId),
    check('site_contact_receipts_key_hash_check', sql`${table.keyHash} ~ '^[0-9a-f]{64}$'`),
    check('site_contact_receipts_fingerprint_check', sql`${table.fingerprint} ~ '^[0-9a-f]{64}$'`),
    pgPolicy('site_contact_receipts_system_access', {
      for: 'all',
      using: systemAccess,
      withCheck: systemAccess,
    }),
  ],
).enableRLS();
