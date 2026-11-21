import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';

import { runWithOrganizationContext } from '@cadenway/nest-common';
import { SystemTransactionRunner, TenantTransactionRunner } from '@cadenway/nest-common/database';
import { JobsModule, JobsService, provisionJobs } from '@cadenway/nest-jobs';
import { Test, type TestingModule } from '@nestjs/testing';
import { drizzle } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import pg from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { SubmitContact } from '../../../../../application/use-cases/commands/forms/submit-contact/submit-contact.use-case.js';
import { SubscribeNewsletter } from '../../../../../application/use-cases/commands/forms/subscribe-newsletter/subscribe-newsletter.use-case.js';
import { RecoverContactSubmissions } from '../../../../../application/use-cases/commands/recovery/recover-contact-submissions/recover-contact-submissions.use-case.js';
import { SystemContactRecoveryUnitOfWork } from '../recovery/system-contact-recovery.unit-of-work.js';
import { SystemContactSubmissionUnitOfWork } from './system-contact-submission.unit-of-work.js';
import { SystemNewsletterSubscriptionUnitOfWork } from './system-newsletter-subscription.unit-of-work.js';

const project = `cadenway-notification-site-form-test-${String(process.pid)}`;
const root = new URL('../../../../../../../../', import.meta.url);
const composeFile = fileURLToPath(new URL('compose.dev.yaml', root));
const migrationsFolder = fileURLToPath(new URL('migrations', root));
const queue = { name: 'email.site-contact-test' } as const;
const form = {
  email: 'Visitor@EXAMPLE.test',
  subject: 'login',
  message: 'Je souhaite récupérer l’accès à mon compte.',
};

function compose(...args: readonly string[]): string {
  return execFileSync(
    'docker',
    ['compose', '--project-name', project, '--file', composeFile, ...args],
    {
      encoding: 'utf8',
      env: { ...process.env, COMPOSE_DISABLE_ENV_FILE: '1', DEV_POSTGRES_PORT: '0' },
      stdio: ['ignore', 'pipe', 'pipe'],
    },
  );
}

describe('public site form transactions', () => {
  let app: TestingModule | undefined;
  let pool: pg.Pool | undefined;
  let system: SystemTransactionRunner;
  let tenant: TenantTransactionRunner;
  let jobs: JobsService;

  const enqueue: ConstructorParameters<typeof SystemContactSubmissionUnitOfWork>[1] = async (
    scope,
    submissionId,
  ) => {
    await jobs.enqueue(scope, queue.name, { submissionId }, { occurrenceKey: submissionId });
  };

  beforeAll(async () => {
    compose('up', '--detach', '--wait', '--wait-timeout', '90', 'postgres');
    const port = compose('port', 'postgres', '5432').trim().split(':').at(-1);
    if (port === undefined || !/^[1-9][0-9]*$/u.test(port)) {
      throw new Error('Compose did not publish PostgreSQL.');
    }
    const migratorConnection = `postgres://notification_migrator:notification_migrator@127.0.0.1:${port}/notification`;
    const connectionString = `postgres://notification_app:notification_app@127.0.0.1:${port}/notification`;
    const migrator = new pg.Pool({ connectionString: migratorConnection });
    try {
      await migrate(drizzle({ client: migrator }), { migrationsFolder });
    } finally {
      await migrator.end();
    }
    await provisionJobs({
      connection: { connectionString: migratorConnection },
      queues: [queue],
      appRole: 'notification_app',
    });
    pool = new pg.Pool({ connectionString });
    system = new SystemTransactionRunner(pool);
    tenant = new TenantTransactionRunner(pool);
    app = await Test.createTestingModule({
      imports: [JobsModule.forRoot({ connection: { connectionString }, queues: [queue] })],
    }).compile();
    await app.init();
    jobs = app.get(JobsService);
  });

  beforeEach(async () => {
    await system.run(async ({ client }) => {
      await client.query('delete from site_contact_receipts');
      await client.query('delete from site_contact_submissions');
      await client.query('delete from site_newsletter_subscriptions');
      await client.query('delete from pgboss.job where name = $1', [queue.name]);
    });
  });

  afterAll(async () => {
    try {
      await app?.close();
    } finally {
      try {
        await pool?.end();
      } finally {
        compose('down', '--volumes', '--remove-orphans');
      }
    }
  });

  it('reserves the key without waiting and commits only one receipt, message and private job', async () => {
    let markEntered: () => void = () => undefined;
    const entered = new Promise<void>((resolve) => {
      markEntered = resolve;
    });
    let finish: () => void = () => undefined;
    const finished = new Promise<void>((resolve) => {
      finish = resolve;
    });
    const paused = new SubmitContact(
      new SystemContactSubmissionUnitOfWork(system, async (scope, submissionId) => {
        await enqueue(scope, submissionId);
        markEntered();
        await finished;
      }),
    );
    const command = new SubmitContact(new SystemContactSubmissionUnitOfWork(system, enqueue));
    const input = { ...form, idempotencyKey: randomUUID() };
    const inFlight = paused.execute(input);
    try {
      await Promise.race([entered, inFlight]);
      await expect(command.execute(input)).resolves.toBe('in-progress');
    } finally {
      finish();
    }
    await expect(inFlight).resolves.toBe('accepted');
    await expect(command.execute(input)).resolves.toBe('accepted');
    await expect(command.execute({ ...input, email: 'Other@example.test' })).resolves.toBe(
      'key-reused',
    );
    await expect(command.execute({ ...input, subject: 'mfa' })).resolves.toBe('key-reused');
    await expect(command.execute({ ...input, message: ` ${form.message}` })).resolves.toBe(
      'key-reused',
    );

    await system.run(async ({ client }) => {
      const { rows: saved } = await client.query(
        'select id, reply_to, subject, message from site_contact_submissions',
      );
      const { rows: receipts } = await client.query(
        `select submission_id, key_hash ~ '^[0-9a-f]{64}$' as hashed_key,
                extract(epoch from expires_at - created_at)::int as retention
           from site_contact_receipts`,
      );
      const { rows: pending } = await client.query(
        `select data->'payload' as payload, data->'organizationId' as tenant
           from pgboss.job where name = $1`,
        [queue.name],
      );
      const [receipt] = receipts as readonly { readonly submission_id: string }[];
      expect(receipt?.submission_id).toEqual(expect.any(String));
      expect(saved).toEqual([
        {
          id: receipt?.submission_id,
          reply_to: form.email,
          subject: form.subject,
          message: { text: form.message },
        },
      ]);
      expect(receipts).toEqual([
        { submission_id: receipt?.submission_id, hashed_key: true, retention: 86_400 },
      ]);
      expect(pending).toEqual([
        { payload: { submissionId: receipt?.submission_id }, tenant: null },
      ]);
    });
  });

  it('rolls back the contact rows and the queued job together, then preserves pending work on reuse after expiry', async () => {
    const failing = new SubmitContact(
      new SystemContactSubmissionUnitOfWork(system, async (scope, submissionId) => {
        await enqueue(scope, submissionId);
        throw new Error('Fixture interrupted acceptance.');
      }),
    );
    const input = { ...form, idempotencyKey: randomUUID() };
    const snapshot = () =>
      system.run(async ({ client }) =>
        client.query(
          `select (select count(*)::int from site_contact_receipts) as receipts,
                  (select count(*)::int from site_contact_submissions where status = 'pending') as pending,
                  (select count(*)::int from pgboss.job where name = $1) as jobs`,
          [queue.name],
        ),
      );
    await expect(failing.execute(input)).rejects.toThrow('Fixture interrupted acceptance.');
    expect((await snapshot()).rows).toEqual([{ receipts: 0, pending: 0, jobs: 0 }]);
    const command = new SubmitContact(new SystemContactSubmissionUnitOfWork(system, enqueue));
    await expect(command.execute(input)).resolves.toBe('accepted');
    await system.run(({ client }) =>
      client.query(
        `update site_contact_receipts set expires_at = clock_timestamp() - interval '1 second'`,
      ),
    );
    await expect(command.execute({ ...input, subject: 'mfa' })).resolves.toBe('accepted');
    expect((await snapshot()).rows).toEqual([{ receipts: 1, pending: 2, jobs: 2 }]);
  });

  it('preserves escaped code units in the accepted form text and its replay', async () => {
    const command = new SubmitContact(new SystemContactSubmissionUnitOfWork(system, enqueue));
    const message = `Texte synthétique ${String.fromCharCode(0, 0xd800)} suivi d’un emoji 😀.`;
    const input = { ...form, message, idempotencyKey: randomUUID() };

    await expect(command.execute(input)).resolves.toBe('accepted');
    await expect(command.execute(input)).resolves.toBe('accepted');
    const { rows } = await system.run(({ client }) =>
      client.query('select message from site_contact_submissions'),
    );
    expect(rows).toEqual([{ message: { text: message } }]);
  });

  it('rechecks stranded work in bounded batches while expiring receipts independently', async () => {
    const seeded = await system.run(async (scope) => {
      const inserted = await scope.client.query(`
        with submissions as (
          insert into site_contact_submissions (reply_to, subject, message, status, updated_at)
          select 'visitor@example.test', 'login', '{"text":"Synthetic fixture message."}'::json,
                 case when n = 55 then 'failed' else 'pending' end,
                 statement_timestamp() - case when n = 56 then interval '1 hour'
                   else interval '26 hours' + (55 - n) * interval '1 second' end
            from generate_series(1, 56) as n
          returning id, status, updated_at
        )
        select id from submissions
         where status = 'pending' and updated_at < statement_timestamp() - interval '25 hours'
         order by updated_at, id
      `);
      const rows = inserted.rows as readonly { readonly id: string }[];
      const retained = rows[0]?.id;
      if (retained === undefined) throw new Error('The stale fixture is missing.');
      await scope.client.query(
        `insert into site_contact_receipts (key_hash, fingerprint, submission_id, expires_at)
         select lpad(n::text, 64, '0'), repeat('a', 64), $1,
                statement_timestamp() + case when n = 53 then interval '1 hour' else interval '-1 hour' end
           from generate_series(1, 53) as n`,
        [retained],
      );
      const original = await jobs.enqueue(
        scope,
        queue.name,
        { submissionId: retained },
        { occurrenceKey: retained },
      );
      return { retained, original, staleIds: rows.map(({ id }) => id) };
    });
    const snapshot = async () =>
      system.run(({ client }) =>
        client.query(
          `select (select count(*)::int from site_contact_receipts) as receipts,
              (select count(*)::int from site_contact_submissions) as submissions,
              (select count(*)::int from site_contact_submissions
                where status = 'pending' and updated_at < statement_timestamp() - interval '25 hours') as stale,
              (select count(*)::int from pgboss.job where name = $1) as jobs`,
          [queue.name],
        ),
      );
    const interrupted = new RecoverContactSubmissions(
      new SystemContactRecoveryUnitOfWork(system, async (scope, submissionId) => {
        await enqueue(scope, submissionId);
        if (submissionId !== seeded.retained) throw new Error('Fixture interrupted recovery.');
      }),
      true,
    );
    await expect(interrupted.execute()).rejects.toThrow('Fixture interrupted recovery.');
    expect((await snapshot()).rows).toEqual([{ receipts: 3, submissions: 56, stale: 54, jobs: 1 }]);

    const recover = new RecoverContactSubmissions(
      new SystemContactRecoveryUnitOfWork(system, enqueue),
      true,
    );
    await recover.execute();
    expect((await snapshot()).rows).toEqual([{ receipts: 1, submissions: 56, stale: 4, jobs: 50 }]);
    await recover.execute();
    expect((await snapshot()).rows).toEqual([{ receipts: 1, submissions: 56, stale: 0, jobs: 54 }]);

    await system.run(async ({ client }) => {
      const scheduled = await client.query(
        `select data->'payload'->>'submissionId' as id from pgboss.job where name = $1 order by id`,
        [queue.name],
      );
      expect(scheduled.rows).toEqual(seeded.staleIds.toSorted().map((id) => ({ id })));
      const receipts = await client.query('select key_hash from site_contact_receipts');
      expect(receipts.rows).toEqual([{ key_hash: '53'.padStart(64, '0') }]);
      await client.query('delete from pgboss.job where name = $1 and id = $2', [
        queue.name,
        seeded.original.jobId,
      ]);
      await client.query(
        `update site_contact_submissions set updated_at = statement_timestamp() - interval '26 hours' where id = $1`,
        [seeded.retained],
      );
    });
    await recover.execute();
    const restored = await system.run(({ client }) =>
      client.query('select id from pgboss.job where name = $1 and id = $2', [
        queue.name,
        seeded.original.jobId,
      ]),
    );
    expect(restored.rows).toEqual([{ id: seeded.original.jobId }]);
  });

  it('deduplicates newsletter domains and leaves suppression and signup time intact', async () => {
    const command = new SubscribeNewsletter(new SystemNewsletterSubscriptionUnitOfWork(system));
    const first = { email: 'Reader@EXAMPLE.test' };
    const replay = { email: 'Reader@example.test' };
    await expect(Promise.all([command.execute(first), command.execute(replay)])).resolves.toEqual([
      'accepted',
      'accepted',
    ]);
    const suppressed = await system.run(({ client }) =>
      client.query(
        `update site_newsletter_subscriptions set status = 'suppressed', updated_at = clock_timestamp()
          where mailbox = $1 returning mailbox, status, created_at, updated_at`,
        [replay.email],
      ),
    );
    expect(suppressed.rows).toHaveLength(1);
    await expect(command.execute(first)).resolves.toBe('accepted');
    await expect(command.execute({ email: 'reader@EXAMPLE.test' })).resolves.toBe('accepted');
    const rows = await system.run(({ client }) =>
      client.query(
        'select mailbox, status, created_at, updated_at from site_newsletter_subscriptions',
      ),
    );
    expect(rows.rows).toHaveLength(2);
    expect(rows.rows).toEqual(expect.arrayContaining(suppressed.rows));
    expect(rows.rows).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ mailbox: 'reader@example.test', status: 'subscribed' }),
      ]),
    );
  });

  it('denies a tenant transaction every global form row and refuses a nested system write', async () => {
    const command = new SubmitContact(new SystemContactSubmissionUnitOfWork(system, enqueue));
    const newsletter = new SubscribeNewsletter(new SystemNewsletterSubscriptionUnitOfWork(system));
    await command.execute({ ...form, idempotencyKey: randomUUID() });
    await newsletter.execute({ email: form.email });
    await runWithOrganizationContext(
      {
        organizationId: '01938f6e-6d1a-7c3e-9a51-2f0c4b8d7e10',
        actor: { type: 'user', id: '01938f6e-8a42-7d5b-b2c9-5e1f3a6d9c24' },
        role: null,
        scopes: [],
      },
      async () => {
        await tenant.run(async ({ client }) => {
          expect((await client.query('select * from site_contact_submissions')).rows).toEqual([]);
          expect((await client.query('select * from site_contact_receipts')).rows).toEqual([]);
          expect((await client.query('select * from site_newsletter_subscriptions')).rows).toEqual(
            [],
          );
          await expect(newsletter.execute({ email: 'Other@example.test' })).rejects.toThrow(
            'A system transaction cannot start inside a tenant transaction.',
          );
        });
        await expect(
          tenant.run(({ client }) =>
            client.query('insert into site_newsletter_subscriptions (mailbox) values ($1)', [
              'Other@example.test',
            ]),
          ),
        ).rejects.toMatchObject({ code: '42501' });
      },
    );
  });
});
