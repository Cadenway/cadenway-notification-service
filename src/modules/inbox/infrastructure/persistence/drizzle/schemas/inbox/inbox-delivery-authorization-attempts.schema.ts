import { organizationPolicy } from '@cadenway/nest-common/database';
import { sql } from 'drizzle-orm';
import { check, pgTable, primaryKey, text, timestamp, unique, uuid } from 'drizzle-orm/pg-core';

import type { InboxAuthorizationAttempt } from '../../../../../application/models/inbox/inbox-authorization-attempt.model.js';
import type { InboxDeliveryCandidate } from '../../../../../application/models/inbox/inbox-delivery-candidate.model.js';

/** One durable, recipient-scoped authorization correlation per source fact. */
export const inboxDeliveryAuthorizationAttempts = pgTable(
  'inbox_delivery_authorization_attempts',
  {
    organizationId: uuid('organization_id').notNull(),
    id: uuid('id')
      .notNull()
      .default(sql`uuidv7()`),
    recipientId: uuid('recipient_id').notNull(),
    sourceEventId: uuid('source_event_id').notNull(),
    actorUserId: uuid('actor_user_id'),
    kind: text('kind').$type<InboxDeliveryCandidate['kind']>().notNull(),
    taskKey: text('task_key').notNull(),
    commentId: uuid('comment_id'),
    status: text('status'),
    outcome: text('outcome')
      .$type<InboxAuthorizationAttempt['outcome']>()
      .notNull()
      .default('pending'),
    expiresAt: timestamp('expires_at', { withTimezone: true, precision: 3 }).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true, precision: 3 }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true, precision: 3 }).notNull().defaultNow(),
  },
  (table) => [
    primaryKey({
      name: 'inbox_delivery_authorization_attempts_pkey',
      columns: [table.organizationId, table.id],
    }),
    unique('inbox_delivery_attempts_source_recipient_unique').on(
      table.organizationId,
      table.recipientId,
      table.sourceEventId,
    ),
    check(
      'inbox_delivery_attempts_outcome_check',
      sql`${table.outcome} in ('pending', 'permitted', 'denied', 'expired')`,
    ),
    check(
      'inbox_delivery_attempts_kind_check',
      sql`${table.kind} in ('assignment', 'comment', 'mention', 'status-change', 'approval', 'access')`,
    ),
    check(
      'inbox_delivery_attempts_distinct_actor_check',
      sql`${table.actorUserId} is distinct from ${table.recipientId}`,
    ),
    check('inbox_delivery_attempts_deadline_check', sql`${table.expiresAt} > ${table.createdAt}`),
    organizationPolicy('inbox_delivery_attempts_organization_isolation'),
  ],
);
