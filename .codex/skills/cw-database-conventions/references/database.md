# Database conventions reference

## Naming

- Tables are plural and snake_case (`api_tokens`); columns are snake_case (`created_at`).

## Common columns

- `id uuid` with `uuidv7()` as default: PostgreSQL 18 generates the id, never application code. A
  display key such as `CAD-482` is a separate column.
- `organization_id` on every tenant-owned table, and **first** in every index a tenant query uses.
- `version`: the version of the aggregate, incremented by each write. It is the `ETag` of the API
  and the `version` field of the events (`cw-outbox-and-events`).
- `created_at` and `updated_at`, both `timestamptz`. Never a `timestamp` without time zone.

## Enumerations

- `text` with a `CHECK` constraint, never a PostgreSQL `enum` type: a new value is then an ordinary
  expand/contract migration.

## Row-level security

- Every table with an `organization_id` has row-level security **enabled and forced**, with a policy
  on `organization_id`.
- The transaction runner of the service kit issues `SET LOCAL app.organization_id` when a use case
  transaction starts. Never set it by hand; never open a connection around the runner.
- Two roles per service: `<svc>_migrator` runs the migrations, `<svc>_app` runs the service and is
  subject to the policies. The service connects with `DATABASE_URL` (`notification_app`);
  `src/migrate.ts` and drizzle-kit with `MIGRATION_DATABASE_URL` (`notification_migrator`). The
  application role reads and writes the tables of `public` only: the migration journal of
  drizzle-kit (`drizzle.__drizzle_migrations`) is out of its reach, as in cadenway-ops.
- Row-level security is the second barrier, not the first: a query still filters on
  `organization_id` explicitly (`rules/infrastructure.md`).

## Connections and timeouts

- A pool of 5 connections per service: twelve backends share one PostgreSQL, and pools of 10 would
  exceed its default of 100 connections. `JobsModule` of `@cadenway/nest-jobs` adds a pool of 2 of
  its own, so this service holds 7 at most.
- `statement_timeout`, `lock_timeout` and `idle_in_transaction_session_timeout` are set per role,
  not per query.

## Tables of the service kit

The outbox, processed-ids and versions tables of `@cadenway/nest-messaging/outbox` and the
`idempotency_keys` table of `@cadenway/nest-common/database` live in this database too. They enter
the migrations by being re-exported from `src/modules/platform/infrastructure/persistence/` (the
platform module owns them and holds no business rule); their definition stays the kit's, so they
are exempt from the naming and common-column rules above. drizzle-kit enables row-level security
on a table that declares a policy but never forces it: every migration that creates a tenant table,
of a business module or of the kit, adds `ALTER TABLE "<table>" FORCE ROW LEVEL SECURITY;` by hand,
as `migrations/0000_platform_tables.sql` does.

## Tables without an organization

A table whose rows belong to no organization (an account, the newsletter) has no `organization_id`.
When it holds personal data or a secret, it still enables and forces row-level security, with a
policy that admits the system runner only (`current_setting('app.system_access', true) = 'on'`):
no tenant transaction can read it. `code_email_deliveries` and `pending_code_emails` of the email
module are the first; `tests/code-email.int-spec.ts` checks that a tenant transaction sees none of
their rows.

Notification preferences also admit a tenant SELECT for one authorized Inbox recipient. The
preferences reader takes the account lock, sets `app.notification_recipient_id` locally in the
active tenant transaction, reads by that account's primary key and clears the setting. Only the
verified recipient of the locked delivery attempt supplies this identifier. The system policy
still governs writes and the regular account read. Email delivery tables remain system-only.

## Not there yet

The two roles exist in cadenway-ops (`docs/database.md` there) and in `compose.dev.yaml`;
`tests/service-wiring.int-spec.ts` proves that the policies of every table are forced, on the kit
tables that one organization cannot read or write another's rows, and that the application role
runs no DDL and cannot reach the migration journal. The linting of migrations is not in place:
until then these conventions are applied by review.
