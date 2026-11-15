---
name: cw-jobs
description: "How to run durable background work with @cadenway/nest-jobs (pg-boss in the service database): the job enqueued in the use case transaction, one key per occurrence, bounded retries, the dead-letter queue. Load it before scheduling, enqueueing or handling a job."
---

# Jobs

Durable background work runs on `pg-boss` through `@cadenway/nest-jobs`, in this service's own
database. `@nestjs/schedule`, BullMQ and in-process timers are not used: none of them survives a
restart, and ESLint refuses the first two.

## Enqueueing

1. The use case enqueues the job **inside its transaction**, next to the state change and the outbox
   record: all commit or none does.
2. One job per outgoing effect: one email, one webhook call. Its idempotency key is the id of the
   send.
3. A job that belongs to an occurrence (a reminder, a digest, a due-date alert) carries a unique key
   for that occurrence; enqueueing it twice is a no-op.

## Scheduled work

- The business table is the source of truth (`due_at`, `sent_at`), not the queue.
- A recurring job claims the due rows with `FOR UPDATE SKIP LOCKED` and enqueues one job per row, so
  a missed or doubled tick changes nothing.

## Handling

1. A handler calls a use case; the use case is idempotent on the job key.
2. Delivery is at least once and never lost. "Never twice" cannot be guaranteed over SMTP or HTTP:
   make a duplicate harmless rather than assuming it away.
3. Retries are bounded, with backoff. A job that exhausts them goes to the dead-letter queue;
   MODULE.md says what an operator does with it.

## Not for

- Events between services: they go through the outbox (`cw-outbox-and-events`).
- Work on another service's data: a job only touches this service's database.

## Wiring

- The queues are declared once, in `src/config/job-queues.ts`, with their retries, timeouts and
  retention; the list goes to `provisionJobs` and to `JobsModule`. A payload holds ids only, never
  personal data or a secret: the data stays in a table of this service that the handler reads
  (`email.send-code` carries the id of a delivery).
- `src/migrate.ts` runs `provisionJobs` as the migrator role after the migrations: it installs the
  `pgboss` schema and the queues and grants `notification_app` its runtime access. The service
  refuses to start while a declared queue is missing.
- `JobsModule` (`src/app.module.ts`) runs as the application role, with a pool of two connections
  of its own. Enqueue with `JobsService.enqueue(tx, ...)` and the scope of a transaction runner of
  the kit; register a handler with `JobsService.work` from `onApplicationBootstrap` of an
  `api/messaging/<name>.handler.ts`. Never import `pg-boss` directly.
