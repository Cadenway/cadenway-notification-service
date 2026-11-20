import { organizationPolicy } from '@cadenway/nest-common/database';
import { sql } from 'drizzle-orm';
import {
  bigint,
  check,
  index,
  integer,
  pgTable,
  text,
  timestamp,
  unique,
  uuid,
} from 'drizzle-orm/pg-core';

/** Recipient-owned inbox records, with an independent deduplication key for each source event. */
export const inboxNotifications = pgTable(
  'inbox_notifications',
  {
    id: uuid('id')
      .primaryKey()
      .default(sql`uuidv7()`),
    organizationId: uuid('organization_id').notNull(),
    recipientId: uuid('recipient_id').notNull(),
    sourceEventId: uuid('source_event_id').notNull(),
    kind: text('kind').notNull(),
    actorUserId: uuid('actor_user_id'),
    subjectKind: text('subject_kind'),
    subjectValue: text('subject_value'),
    commentId: uuid('comment_id'),
    status: text('status'),
    creationGeneration: bigint('creation_generation', { mode: 'bigint' }).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true, precision: 3 }).notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true, precision: 3 }).notNull(),
    readAt: timestamp('read_at', { withTimezone: true, precision: 3 }),
    archivedAt: timestamp('archived_at', { withTimezone: true, precision: 3 }),
    version: integer('version').notNull().default(1),
  },
  (table) => [
    unique('inbox_notifications_source_recipient_unique').on(
      table.organizationId,
      table.recipientId,
      table.sourceEventId,
    ),
    index('inbox_notifications_recipient_page_index').on(
      table.organizationId,
      table.recipientId,
      table.createdAt,
      table.id,
    ),
    index('inbox_notifications_unread_page_index')
      .on(table.organizationId, table.recipientId, table.createdAt, table.id)
      .where(sql`${table.readAt} is null and ${table.archivedAt} is null`),
    index('inbox_notifications_archived_page_index')
      .on(table.organizationId, table.recipientId, table.createdAt, table.id)
      .where(sql`${table.archivedAt} is not null`),
    index('inbox_notifications_unread_subject_index')
      .on(table.organizationId, table.recipientId, table.subjectKind, table.subjectValue)
      .where(sql`${table.readAt} is null and ${table.archivedAt} is null`),
    check('inbox_notifications_version_check', sql`${table.version} >= 1`),
    check('inbox_notifications_generation_check', sql`${table.creationGeneration} >= 1`),
    check(
      'inbox_notifications_subject_check',
      sql`((${table.subjectKind} is null and ${table.subjectValue} is null)
        or (${table.subjectKind} = 'task-key' and ${table.subjectValue} ~ '^[A-Z]{2,5}-[1-9][0-9]{0,8}$')
        or (${table.subjectKind} in ('task-id', 'space', 'list') and ${table.subjectValue} ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$')) is true`,
    ),
    check(
      'inbox_notifications_time_check',
      sql`${table.updatedAt} >= ${table.createdAt} and (${table.readAt} is null or ${table.readAt} >= ${table.createdAt}) and (${table.archivedAt} is null or ${table.archivedAt} >= ${table.createdAt})`,
    ),
    organizationPolicy('inbox_notifications_organization_isolation'),
  ],
);
