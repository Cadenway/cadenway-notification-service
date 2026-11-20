import { sql } from 'drizzle-orm';
import {
  boolean,
  check,
  integer,
  jsonb,
  pgPolicy,
  pgTable,
  text,
  timestamp,
  uuid,
} from 'drizzle-orm/pg-core';

import type { NotificationPreferencesSnapshot } from '../../../../../domain/value-objects/preferences/notification-preferences-snapshot.value-object.js';

/** Preferences belong to an account independently of any selected organization. */
export const notificationPreferences = pgTable(
  'notification_preferences',
  {
    userId: uuid('user_id').primaryKey(),
    channels: jsonb('channels').$type<NotificationPreferencesSnapshot['channels']>().notNull(),
    digest: text('digest').$type<NotificationPreferencesSnapshot['digest']>().notNull(),
    doNotDisturb: boolean('do_not_disturb').notNull(),
    version: integer('version').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true, precision: 3 }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true, precision: 3 }).notNull().defaultNow(),
  },
  (table) => [
    check(
      'notification_preferences_digest_check',
      sql`${table.digest} in ('each', 'daily', 'weekly', 'never')`,
    ),
    check('notification_preferences_version_check', sql`${table.version} >= 1`),
    pgPolicy('notification_preferences_system_access', {
      as: 'permissive',
      for: 'all',
      using: sql`current_setting('app.system_access', true) = 'on'`,
      withCheck: sql`current_setting('app.system_access', true) = 'on'`,
    }),
    pgPolicy('notification_preferences_recipient_read', {
      as: 'permissive',
      for: 'select',
      using: sql`nullif(current_setting('app.organization_id', true), '') is not null and ${table.userId} = nullif(current_setting('app.notification_recipient_id', true), '')::uuid`,
    }),
  ],
);
