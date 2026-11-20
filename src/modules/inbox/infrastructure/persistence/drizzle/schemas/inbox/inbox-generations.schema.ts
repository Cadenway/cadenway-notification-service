import { organizationPolicy } from '@cadenway/nest-common/database';
import { sql } from 'drizzle-orm';
import { bigint, check, pgTable, primaryKey, uuid } from 'drizzle-orm/pg-core';

/** Serializes inbox mutations for one recipient and organization. */
export const inboxGenerations = pgTable(
  'inbox_generations',
  {
    organizationId: uuid('organization_id').notNull(),
    recipientId: uuid('recipient_id').notNull(),
    generation: bigint('generation', { mode: 'bigint' })
      .notNull()
      .default(sql`0`),
  },
  (table) => [
    primaryKey({ columns: [table.organizationId, table.recipientId] }),
    check('inbox_generations_nonnegative_check', sql`${table.generation} >= 0`),
    organizationPolicy('inbox_generations_organization_isolation'),
  ],
);
