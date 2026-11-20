import { organizationPolicy } from '@cadenway/nest-common/database';
import { sql } from 'drizzle-orm';
import { bigint, check, pgTable, primaryKey, uuid } from 'drizzle-orm/pg-core';

/** Monotonic generation of an owner's reminder candidates within an organization. */
export const reminderGenerations = pgTable(
  'reminder_generations',
  {
    organizationId: uuid('organization_id').notNull(),
    userId: uuid('user_id').notNull(),
    generation: bigint('generation', { mode: 'bigint' })
      .notNull()
      .default(sql`0`),
  },
  (table) => [
    primaryKey({ columns: [table.organizationId, table.userId] }),
    check('reminder_generations_nonnegative_check', sql`${table.generation} >= 0`),
    organizationPolicy('reminder_generations_organization_isolation'),
  ],
);
