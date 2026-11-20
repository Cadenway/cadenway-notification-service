import { organizationPolicy } from '@cadenway/nest-common/database';
import { sql } from 'drizzle-orm';
import {
  boolean,
  check,
  foreignKey,
  index,
  integer,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';

import { reminders } from './reminders.schema.js';

/** Immutable attempt bindings, with one current generation for each reminder. */
export const reminderAuthorizationAttempts = pgTable(
  'reminder_authorization_attempts',
  {
    organizationId: uuid('organization_id').notNull(),
    id: uuid('id').notNull(),
    reminderId: uuid('reminder_id').notNull(),
    userId: uuid('user_id').notNull(),
    taskId: uuid('task_id').notNull(),
    reminderVersion: integer('reminder_version').notNull(),
    scheduleVersion: integer('schedule_version').notNull(),
    expiresAt: timestamp('expires_at', { withTimezone: true, precision: 3 }).notNull(),
    status: text('status').notNull(),
    current: boolean('current').notNull().default(true),
  },
  (table) => [
    primaryKey({
      name: 'reminder_authorization_attempts_pkey',
      columns: [table.organizationId, table.id],
    }),
    foreignKey({
      name: 'reminder_authorization_attempts_reminder_fkey',
      columns: [table.organizationId, table.reminderId],
      foreignColumns: [reminders.organizationId, reminders.id],
    }).onDelete('cascade'),
    uniqueIndex('reminder_authorization_attempts_current_unique')
      .on(table.organizationId, table.reminderId)
      .where(sql`${table.current}`),
    index('reminder_authorization_attempts_expiry_index').on(
      table.organizationId,
      table.expiresAt,
      table.id,
    ),
    check(
      'reminder_authorization_attempts_status_check',
      sql`${table.status} in ('pending', 'permitted', 'denied', 'expired')`,
    ),
    check(
      'reminder_authorization_attempts_version_check',
      sql`${table.scheduleVersion} >= 1 and ${table.reminderVersion} >= ${table.scheduleVersion}`,
    ),
    organizationPolicy('reminder_authorization_attempts_organization_isolation'),
  ],
);
