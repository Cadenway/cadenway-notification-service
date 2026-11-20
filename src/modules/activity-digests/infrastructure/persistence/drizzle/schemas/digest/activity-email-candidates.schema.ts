import { organizationPolicy } from '@cadenway/nest-common/database';
import { sql } from 'drizzle-orm';
import {
  check,
  foreignKey,
  index,
  integer,
  pgTable,
  primaryKey,
  text,
  timestamp,
  unique,
  uuid,
} from 'drizzle-orm/pg-core';

import type { ActivityEmailCandidate } from '../../../../../application/models/digest/activity-email-candidate.model.js';
import { activityEmailOccurrences } from './activity-email-occurrences.schema.js';

/** Deduplicated activity selectors, owned by the tenant that produced them. */
export const activityEmailCandidates = pgTable(
  'activity_email_candidates',
  {
    organizationId: uuid('organization_id').notNull(),
    id: uuid('id')
      .notNull()
      .default(sql`uuidv7()`),
    recipientId: uuid('recipient_id').notNull(),
    sourceEventId: uuid('source_event_id').notNull(),
    actorUserId: uuid('actor_user_id'),
    kind: text('kind').$type<ActivityEmailCandidate['kind']>().notNull(),
    taskKey: text('task_key').notNull(),
    commentId: uuid('comment_id'),
    status: text('status'),
    occurrenceId: uuid('occurrence_id'),
    generation: integer('generation'),
    settledAt: timestamp('settled_at', { withTimezone: true, precision: 3 }),
    createdAt: timestamp('created_at', { withTimezone: true, precision: 3 }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true, precision: 3 }).notNull().defaultNow(),
  },
  (table) => [
    primaryKey({
      name: 'activity_email_candidates_pkey',
      columns: [table.organizationId, table.id, table.recipientId],
    }),
    unique('activity_email_candidates_recipient_id_unique').on(table.recipientId, table.id),
    unique('activity_email_candidates_source_recipient_unique').on(
      table.organizationId,
      table.recipientId,
      table.sourceEventId,
    ),
    foreignKey({
      name: 'activity_email_candidates_occurrence_fk',
      columns: [table.recipientId, table.occurrenceId],
      foreignColumns: [activityEmailOccurrences.recipientId, activityEmailOccurrences.id],
    }),
    index('activity_email_candidates_pending_recipient_idx')
      .on(table.recipientId, table.createdAt, table.id)
      .where(sql`${table.occurrenceId} is null and ${table.settledAt} is null`),
    index('activity_email_candidates_account_occurrence_idx').on(
      table.recipientId,
      table.occurrenceId,
      table.generation,
      table.id,
    ),
    index('activity_email_candidates_tenant_occurrence_idx').on(
      table.organizationId,
      table.recipientId,
      table.occurrenceId,
      table.generation,
      table.id,
    ),
    check(
      'activity_email_candidates_kind_check',
      sql`${table.kind} in ('assignment', 'comment', 'mention', 'status-change', 'approval', 'access')`,
    ),
    check(
      'activity_email_candidates_actor_check',
      sql`${table.actorUserId} is distinct from ${table.recipientId}`,
    ),
    check(
      'activity_email_candidates_assignment_check',
      sql`(${table.occurrenceId} is null and ${table.generation} is null and ${table.settledAt} is null)
        or (${table.occurrenceId} is not null and ${table.generation} is not null and ${table.generation} >= 1)`,
    ),
    organizationPolicy('activity_email_candidates_tenant_isolation'),
  ],
);
