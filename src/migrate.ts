import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { loadConfig } from '@cadenway/nest-common';
import { provisionJobs } from '@cadenway/nest-jobs';
import { finishOutboxLeaseMigration } from '@cadenway/nest-messaging/outbox/schema';
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

/** Describes an index that can be prepared before its Drizzle journal entry. */
interface OnlineIndex {
  // #region Properties
  /** Index name in the public schema. */
  readonly name: string;

  /** Table that owns the index. */
  readonly table: string;

  /** Journaled migration that declares the index. */
  readonly migration: string;

  /** Canonical index columns and optional predicate reported by PostgreSQL. */
  readonly canonicalSuffix: string;
  // #endregion
}

// Checking PostgreSQL 18's canonical definition keeps IF NOT EXISTS and interrupted-build
// recovery from accepting a different relation with the same name.
const onlineIndexes: readonly OnlineIndex[] = [
  {
    name: 'inbox_notifications_unread_subject_cursor_index',
    table: 'inbox_notifications',
    migration: '0011_inbox_unread_subject_cursor.sql',
    canonicalSuffix: [
      `(organization_id, recipient_id, COALESCE(subject_kind, ''::text) COLLATE "C",`,
      `COALESCE(subject_value, ''::text) COLLATE "C")`,
      'WHERE ((read_at IS NULL) AND (archived_at IS NULL))',
    ].join(' '),
  },
  {
    name: 'site_contact_receipts_submission_index',
    table: 'site_contact_receipts',
    migration: '0012_site_contact_retention.sql',
    canonicalSuffix: '(submission_id)',
  },
  {
    name: 'site_contact_submissions_sent_expiry_index',
    table: 'site_contact_submissions',
    migration: '0012_site_contact_retention.sql',
    canonicalSuffix: "(updated_at, id) WHERE (status = 'sent'::text)",
  },
  {
    name: 'site_contact_submissions_undelivered_expiry_index',
    table: 'site_contact_submissions',
    migration: '0012_site_contact_retention.sql',
    canonicalSuffix:
      "(created_at, id) WHERE (status = ANY (ARRAY['pending'::text, 'failed'::text]))",
  },
];

async function readOnlineIndex(client: pg.PoolClient, index: OnlineIndex) {
  const result = await client.query<{
    readonly tableExists: boolean;
    readonly indexExists: boolean;
    readonly definition: string | null;
    readonly usable: boolean | null;
  }>(
    `SELECT to_regclass($2) IS NOT NULL AS "tableExists",
       existing.oid IS NOT NULL AS "indexExists", pg_get_indexdef(idx.indexrelid) AS definition,
       idx.indisvalid AND idx.indisready AND idx.indislive AS usable
     FROM (SELECT to_regclass($1) AS oid) AS existing
     LEFT JOIN pg_index AS idx ON idx.indexrelid = existing.oid`,
    [`public.${index.name}`, `public.${index.table}`],
  );
  const [existing] = result.rows;
  if (existing === undefined) throw new Error(`Could not inspect index ${index.name}.`);
  return existing;
}

async function prepareOnlineIndex(client: pg.PoolClient, index: OnlineIndex): Promise<void> {
  const existing = await readOnlineIndex(client, index);
  const definition = `CREATE INDEX ${index.name} ON public.${index.table} USING btree ${index.canonicalSuffix}`;
  if (existing.indexExists && existing.definition !== definition) {
    throw new Error(`The existing index ${index.name} has an unexpected definition.`);
  }
  if (!existing.tableExists || existing.usable === true) return;

  const prefix = `CREATE INDEX IF NOT EXISTS "${index.name}" ON "${index.table}" `;
  const statements = readFileSync(join(migrationsFolder, index.migration), 'utf8')
    .split('--> statement-breakpoint')
    .map((statement) => statement.trim())
    .filter((statement) => statement.startsWith(prefix));
  const [ddl] = statements;
  if (statements.length !== 1 || ddl === undefined || !/^[^;]+;$/u.test(ddl)) {
    throw new Error(`The migration must contain exactly one creation statement for ${index.name}.`);
  }
  if (existing.indexExists) await client.query(`DROP INDEX CONCURRENTLY public.${index.name}`);
  await client.query(
    `CREATE INDEX CONCURRENTLY IF NOT EXISTS "${index.name}" ON public.${index.table} ${ddl.slice(prefix.length)}`,
  );
  const built = await readOnlineIndex(client, index);
  if (built.usable !== true || built.definition !== definition) {
    throw new Error(`Could not make index ${index.name} available with its expected definition.`);
  }
}

if (!existsSync(`${migrationsFolder}/meta/_journal.json`)) {
  console.log('No migration has been generated yet: nothing to apply.');
} else {
  const migration: Readonly<MigrationConfig> = loadConfig(migrationConfigSchema);
  const pool = new pg.Pool({
    connectionString: migration.MIGRATION_DATABASE_URL,
    application_name: 'notification-service-migrator',
  });
  try {
    const client = await pool.connect();
    try {
      // One session covers Drizzle's journal and both phases of the online index builds.
      await client.query(
        "SELECT pg_advisory_lock(hashtextextended('notification-service:migrations', 0))",
      );
      for (const index of onlineIndexes) await prepareOnlineIndex(client, index);
      await migrate(drizzle({ client }), { migrationsFolder });
      await finishOutboxLeaseMigration(client);
    } finally {
      client.release(true);
    }
    console.log('Migrations applied.');
  } finally {
    await pool.end();
  }
  await provisionJobs({
    connection: { connectionString: migration.MIGRATION_DATABASE_URL },
    appRole: APP_ROLE,
    queues: jobQueues,
  });
  console.log('Job queues provisioned.');
}
