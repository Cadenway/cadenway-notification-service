import { organizationPolicy } from '@cadenway/nest-common/database';
import { sql } from 'drizzle-orm';
import {
  check,
  index,
  integer,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';

/** Tenant-owned personal reminders and their current schedule revision. */
export const reminders = pgTable(
  'reminders',
  {
    organizationId: uuid('organization_id').notNull(),
    id: uuid('id')
      .notNull()
      .default(sql`uuidv7()`),
    userId: uuid('user_id').notNull(),
    taskId: uuid('task_id').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true, precision: 3 }).notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true, precision: 3 }).notNull(),
    remindAt: timestamp('remind_at', { withTimezone: true, precision: 3 }).notNull(),
    note: text('note'),
    firedAt: timestamp('fired_at', { withTimezone: true, precision: 3 }),
    completedAt: timestamp('completed_at', { withTimezone: true, precision: 3 }),
    version: integer('version').notNull(),
    scheduleVersion: integer('schedule_version').notNull(),
  },
  (table) => [
    primaryKey({ name: 'reminders_pkey', columns: [table.organizationId, table.id] }),
    uniqueIndex('reminders_pending_task_unique')
      .on(table.organizationId, table.userId, table.taskId)
      .where(sql`${table.completedAt} is null`),
    index('reminders_owner_page_index').on(
      table.organizationId,
      table.userId,
      table.remindAt,
      table.id,
    ),
    check(
      'reminders_version_check',
      sql`${table.scheduleVersion} >= 1 and ${table.version} >= ${table.scheduleVersion}`,
    ),
    check(
      'reminders_time_check',
      sql`${table.remindAt} > ${table.createdAt} and (${table.firedAt} is null or ${table.firedAt} >= ${table.remindAt}) and (${table.completedAt} is null or ${table.completedAt} >= coalesce(${table.firedAt}, ${table.createdAt}))`,
    ),
    check('reminders_note_check', sql`${table.note} is null or char_length(${table.note}) <= 500`),
    organizationPolicy('reminders_organization_isolation'),
  ],
);
