import { organizationPolicy } from '@cadenway/nest-common/database';
import { sql } from 'drizzle-orm';
import {
  check,
  foreignKey,
  integer,
  pgTable,
  primaryKey,
  text,
  timestamp,
  unique,
  uuid,
} from 'drizzle-orm/pg-core';

import type { ActivityAuthorizationAttempt } from '../../../../../application/models/digest/activity-authorization-attempt.model.js';
import { activityEmailCandidates } from './activity-email-candidates.schema.js';
import { activityEmailOccurrences } from './activity-email-occurrences.schema.js';

/** Current tenant authorization correlation for each candidate and occurrence generation. */
export const activityEmailAuthorizationAttempts = pgTable(
  'activity_email_authorization_attempts',
  {
    organizationId: uuid('organization_id').notNull(),
    id: uuid('id')
      .notNull()
      .default(sql`uuidv7()`),
    recipientId: uuid('recipient_id').notNull(),
    candidateId: uuid('candidate_id').notNull(),
    occurrenceId: uuid('occurrence_id').notNull(),
    generation: integer('generation').notNull(),
    outcome: text('outcome')
      .$type<ActivityAuthorizationAttempt['outcome']>()
      .notNull()
      .default('pending'),
    expiresAt: timestamp('expires_at', { withTimezone: true, precision: 3 }).notNull(),
    validUntil: timestamp('valid_until', { withTimezone: true, precision: 3 }),
    createdAt: timestamp('created_at', { withTimezone: true, precision: 3 }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true, precision: 3 }).notNull().defaultNow(),
  },
  (table) => [
    primaryKey({
      name: 'activity_email_authorization_attempts_pkey',
      columns: [table.organizationId, table.id],
    }),
    unique('activity_email_authorization_attempts_item_unique').on(
      table.organizationId,
      table.candidateId,
      table.recipientId,
      table.occurrenceId,
      table.generation,
    ),
    foreignKey({
      name: 'activity_email_authorization_attempts_candidate_fk',
      columns: [table.organizationId, table.candidateId, table.recipientId],
      foreignColumns: [
        activityEmailCandidates.organizationId,
        activityEmailCandidates.id,
        activityEmailCandidates.recipientId,
      ],
    }),
    foreignKey({
      name: 'activity_email_authorization_attempts_occurrence_fk',
      columns: [table.recipientId, table.occurrenceId],
      foreignColumns: [activityEmailOccurrences.recipientId, activityEmailOccurrences.id],
    }),
    check('activity_email_authorization_attempts_generation_check', sql`${table.generation} >= 1`),
    check(
      'activity_email_authorization_attempts_outcome_check',
      sql`(${table.outcome} = 'pending' and ${table.validUntil} is null)
        or (${table.outcome} in ('permitted', 'denied', 'expired') and ${table.validUntil} is not null and ${table.validUntil} <= ${table.expiresAt})`,
    ),
    check(
      'activity_email_authorization_attempts_expiry_check',
      sql`${table.expiresAt} > ${table.createdAt}`,
    ),
    organizationPolicy('activity_email_authorization_attempts_tenant_isolation'),
  ],
);
