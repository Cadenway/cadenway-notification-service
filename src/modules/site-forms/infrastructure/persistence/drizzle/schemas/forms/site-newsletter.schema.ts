import { sql } from 'drizzle-orm';
import { check, pgPolicy, pgTable, text, timestamp } from 'drizzle-orm/pg-core';

const systemAccess = sql`current_setting('app.system_access', true) = 'on'`;

/** One canonical address and its current newsletter subscription state. */
export const siteNewsletterSubscriptions = pgTable(
  'site_newsletter_subscriptions',
  {
    mailbox: text('mailbox').primaryKey(),
    status: text('status').notNull().default('subscribed'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    check(
      'site_newsletter_subscriptions_mailbox_check',
      sql`length(${table.mailbox}) between 3 and 254`,
    ),
    check(
      'site_newsletter_subscriptions_status_check',
      sql`${table.status} in ('subscribed', 'unsubscribed', 'suppressed')`,
    ),
    pgPolicy('site_newsletter_subscriptions_system_access', {
      for: 'all',
      using: systemAccess,
      withCheck: systemAccess,
    }),
  ],
).enableRLS();
