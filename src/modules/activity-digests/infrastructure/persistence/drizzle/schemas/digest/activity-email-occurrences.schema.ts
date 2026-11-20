import { sql } from 'drizzle-orm';
import {
  check,
  date,
  index,
  integer,
  pgPolicy,
  pgTable,
  text,
  timestamp,
  unique,
  uuid,
} from 'drizzle-orm/pg-core';

import type { ActivityEmailOccurrence } from '../../../../../domain/value-objects/digest/activity-email-occurrence.value-object.js';

/** Account-owned delivery slots shared by all organizations contributing to the digest. */
export const activityEmailOccurrences = pgTable(
  'activity_email_occurrences',
  {
    id: uuid('id')
      .primaryKey()
      .default(sql`uuidv7()`),
    recipientId: uuid('recipient_id').notNull(),
    cadence: text('cadence').$type<ActivityEmailOccurrence['cadence']>().notNull(),
    localDate: date('local_date'),
    batchNumber: integer('batch_number'),
    individualCandidateId: uuid('individual_candidate_id'),
    dueAt: timestamp('due_at', { withTimezone: true, precision: 3 }).notNull(),
    generation: integer('generation').notNull().default(1),
    preferenceVersion: integer('preference_version').notNull(),
    profileVersion: integer('profile_version').notNull(),
    state: text('state')
      .$type<'scheduled' | 'superseded' | 'completed'>()
      .notNull()
      .default('scheduled'),
    leaseId: uuid('lease_id'),
    leaseUntil: timestamp('lease_until', { withTimezone: true, precision: 3 }),
    createdAt: timestamp('created_at', { withTimezone: true, precision: 3 }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true, precision: 3 }).notNull().defaultNow(),
  },
  (table) => [
    unique('activity_email_occurrences_recipient_id_unique').on(table.recipientId, table.id),
    unique('activity_email_occurrences_epoch_batch_unique').on(
      table.recipientId,
      table.cadence,
      table.localDate,
      table.batchNumber,
    ),
    unique('activity_email_occurrences_individual_unique').on(
      table.recipientId,
      table.individualCandidateId,
    ),
    index('activity_email_occurrences_superseded_idx')
      .on(table.recipientId, table.cadence, table.localDate, table.batchNumber)
      .where(sql`${table.state} = 'superseded'`),
    check(
      'activity_email_occurrences_identity_check',
      sql`(${table.cadence} = 'each' and ${table.individualCandidateId} is not null and ${table.localDate} is null and ${table.batchNumber} is null)
        or (${table.cadence} in ('daily', 'weekly') and ${table.individualCandidateId} is null and ${table.localDate} is not null and ${table.batchNumber} is not null and ${table.batchNumber} >= 1)`,
    ),
    check(
      'activity_email_occurrences_versions_check',
      sql`${table.generation} >= 1 and ${table.preferenceVersion} >= 1 and ${table.profileVersion} >= 1`,
    ),
    check(
      'activity_email_occurrences_lease_check',
      sql`${table.state} in ('scheduled', 'superseded', 'completed')
        and (${table.leaseId} is null) = (${table.leaseUntil} is null)
        and (${table.state} = 'scheduled' or ${table.leaseId} is null)`,
    ),
    pgPolicy('activity_email_occurrences_system_access', {
      as: 'permissive',
      for: 'all',
      using: sql`current_setting('app.system_access', true) = 'on'`,
      withCheck: sql`current_setting('app.system_access', true) = 'on'`,
    }),
  ],
);
