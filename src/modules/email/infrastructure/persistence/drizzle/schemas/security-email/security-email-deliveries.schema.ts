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
 * (`app.system_access = 'on'`). A security e-mail belongs to an account, not to an organization,
 * so the table carries no `organization_id`; the policy keeps it out of every tenant transaction.
 *
 * @type {SQL}
 */
const systemAccess: SQL = sql`current_setting('app.system_access', true) = 'on'`;

/**
 * The send log of the security e-mails (`securityEmailDeliveries`): one row per identity-service
 * event (unique `event_id`), naming the event and the account by their ids, with the template, the
 * language of the account, the send window, where the e-mail stands and when it was sent. It never
 * holds the address, the device, the IP address nor a reset token: those wait in
 * `pending_security_emails`.
 *
 * `template`, `status` and `skip_reason` follow `SecurityEmailTemplate`,
 * `SecurityEmailDeliveryStatus` and `SecurityEmailSkipReason`; a `skip_reason` exists exactly when
 * the row is `skipped`, a `sent_at` exactly when it is `sent`; `template` is missing exactly when
 * the event asked for no e-mail this version knows (`change-not-supported`, a later `change` of
 * `user.two-step-verification-changed.v1`); the window closes after the event and within a day
 * (`SendWindow`). Its id is the payload and the idempotency key of the job that sends the e-mail.
 * Row-level security is forced by the migration, which drizzle-kit does not generate.
 */
export default pgTable(
  'security_email_deliveries',
  {
    id: uuid('id')
      .primaryKey()
      .default(sql`uuidv7()`),
    eventId: uuid('event_id').notNull(),
    userId: uuid('user_id').notNull(),
    template: text('template'),
    language: text('language').notNull(),
    occurredAt: timestamp('occurred_at', { withTimezone: true }).notNull(),
    sendBefore: timestamp('send_before', { withTimezone: true }).notNull(),
    status: text('status').notNull(),
    skipReason: text('skip_reason'),
    sentAt: timestamp('sent_at', { withTimezone: true }),
    version: integer('version').notNull().default(1),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    unique('security_email_deliveries_event_id_unique').on(table.eventId),
    // The sweep reads the `queued` rows whose window closed, oldest first.
    index('security_email_deliveries_queued_send_before_index')
      .on(table.sendBefore)
      .where(sql`${table.status} = 'queued'`),
    check(
      'security_email_deliveries_template_check',
      sql`(${table.template} is null) = (${table.skipReason} is not distinct from 'change-not-supported') and (${table.template} is null or ${table.template} in ('password-reset', 'password-changed', 'email-changed', 'new-device', 'deletion-scheduled', 'deletion-cancelled', 'two-step-enabled', 'two-step-disabled', 'authenticator-app-replaced', 'backup-codes-regenerated', 'security-key-added', 'security-key-removed'))`,
    ),
    check(
      'security_email_deliveries_status_check',
      sql`${table.status} in ('queued', 'sent', 'skipped', 'failed')`,
    ),
    check(
      'security_email_deliveries_skip_reason_check',
      sql`(${table.status} = 'skipped') = (${table.skipReason} is not null) and (${table.skipReason} is null or ${table.skipReason} in ('expired', 'change-not-supported'))`,
    ),
    check(
      'security_email_deliveries_sent_at_check',
      sql`(${table.status} = 'sent') = (${table.sentAt} is not null)`,
    ),
    check(
      'security_email_deliveries_window_check',
      sql`${table.sendBefore} > ${table.occurredAt} and ${table.sendBefore} <= ${table.occurredAt} + interval '1 day'`,
    ),
    pgPolicy('security_email_deliveries_system_access', {
      as: 'permissive',
      for: 'all',
      using: systemAccess,
      withCheck: systemAccess,
    }),
  ],
);
