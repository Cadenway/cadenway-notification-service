import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { loadConfig } from '@cadenway/nest-common';
import { provisionJobs } from '@cadenway/nest-jobs';
import { drizzle } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import pg from 'pg';

import { migrationConfigSchema } from './config/app-config.js';
import type { MigrationConfig } from './config/app-config.js';
import { jobQueues } from './config/job-queues.js';

// Entry point of the one-off migration container (`node dist/migrate.js`), which the GitOps agent of
// cadenway-ops runs before it starts a new version. drizzle-kit is a development dependency and is
// not in the production image, so the migrations are applied with the runtime migrator.
//
// They run as the migrator role of MIGRATION_DATABASE_URL, which owns the tables: the application
// role of DATABASE_URL holds no DDL right and would be refused. The variable is validated only when
// there is something to apply, and a missing or malformed one stops the container with a
// ConfigError that names it.
//
// Then `provisionJobs` of @cadenway/nest-jobs installs or migrates the pg-boss schema (`pgboss`),
// creates or updates the queues of src/config/job-queues.ts and their dead-letter queues, and
// grants the application role its runtime access to them, which holds no DDL either. It is
// idempotent, like the migrations: the container runs both on every deployment.
/**
 * Constant migrationsFolder
 *
 * @description
 * Location of the migration files included in the service image.
 *
 * @type {string}
 */
const migrationsFolder: string = fileURLToPath(new URL('../migrations', import.meta.url));

/**
 * Constant APP_ROLE
 *
 * @description
 * The application role of this service's database, `notification_app` in every environment of
 * cadenway-ops (`docs/database.md` there) and in `compose.dev.yaml`: the role `provisionJobs`
 * grants the runtime access of the pg-boss schema to.
 *
 * @type {string}
 */
const APP_ROLE: string = 'notification_app';

const inboxCursorIndex = 'inbox_notifications_unread_subject_cursor_index';
const inboxCursorMigration = '0011_inbox_unread_subject_cursor.sql';

// PostgreSQL 18's canonical definition for the dedicated migration. Checking it before any
// recovery keeps IF NOT EXISTS and DROP from accepting an unrelated relation with this name.
const inboxCursorDefinition = [
  `CREATE INDEX ${inboxCursorIndex} ON public.inbox_notifications USING btree`,
  `(organization_id, recipient_id, COALESCE(subject_kind, ''::text) COLLATE "C",`,
  `COALESCE(subject_value, ''::text) COLLATE "C")`,
  'WHERE ((read_at IS NULL) AND (archived_at IS NULL))',
].join(' ');

async function readInboxCursorIndex(client: pg.Client) {
  const result = await client.query<{
    readonly tableExists: boolean;
    readonly indexExists: boolean;
    readonly definition: string | null;
    readonly usable: boolean | null;
  }>(
    `SELECT to_regclass('public.inbox_notifications') IS NOT NULL AS "tableExists",
       existing.oid IS NOT NULL AS "indexExists", pg_get_indexdef(idx.indexrelid) AS definition,
       idx.indisvalid AND idx.indisready AND idx.indislive AS usable
     FROM (SELECT to_regclass($1) AS oid) AS existing
     LEFT JOIN pg_index AS idx ON idx.indexrelid = existing.oid`,
    [`public.${inboxCursorIndex}`],
  );
  const [index] = result.rows;
  if (index === undefined) throw new Error('Could not inspect the inbox cursor index.');
  return index;
}

async function prepareInboxCursorIndex(client: pg.Client): Promise<void> {
  const index = await readInboxCursorIndex(client);
  if (index.indexExists && index.definition !== inboxCursorDefinition) {
    throw new Error('The existing inbox cursor index has an unexpected definition.');
  }
  if (!index.tableExists || index.usable === true) return;

  const ddl = readFileSync(join(migrationsFolder, inboxCursorMigration), 'utf8').trim();
  const prefix = `CREATE INDEX IF NOT EXISTS "${inboxCursorIndex}" ON "inbox_notifications" `;
  if (!ddl.startsWith(prefix) || !/^[^;]+;$/u.test(ddl)) {
    throw new Error('The inbox cursor migration must contain one index creation statement.');
  }
  if (index.indexExists) await client.query(`DROP INDEX CONCURRENTLY public.${inboxCursorIndex}`);
  await client.query(
    `CREATE INDEX CONCURRENTLY IF NOT EXISTS "${inboxCursorIndex}" ON public.inbox_notifications ${ddl.slice(prefix.length)}`,
  );
  const built = await readInboxCursorIndex(client);
  if (built.usable !== true || built.definition !== inboxCursorDefinition) {
    throw new Error('Could not make the expected inbox cursor index available.');
  }
}

if (!existsSync(`${migrationsFolder}/meta/_journal.json`)) {
  console.log('No migration has been generated yet: nothing to apply.');
} else {
  const migration: Readonly<MigrationConfig> = loadConfig(migrationConfigSchema);
  const client: pg.Client = new pg.Client({
    connectionString: migration.MIGRATION_DATABASE_URL,
    application_name: 'notification-service-migrator',
  });
  try {
    await client.connect();
    // The session lock covers the online index and Drizzle's journal. Closing the session releases
    // it after success, failure or interruption. Fresh databases build the index on the new table.
    await client.query(
      "SELECT pg_advisory_lock(hashtextextended('notification-service:migrations', 0))",
    );
    await prepareInboxCursorIndex(client);
    await migrate(drizzle({ client }), { migrationsFolder });
    console.log('Migrations applied.');
  } finally {
    await client.end();
  }
  await provisionJobs({
    connection: { connectionString: migration.MIGRATION_DATABASE_URL },
    appRole: APP_ROLE,
    queues: jobQueues,
  });
  console.log('Job queues provisioned.');
}
