import { createHash } from 'node:crypto';

import type { SystemTransactionRunner, TransactionScope } from '@cadenway/nest-common/database';
import { and, eq, gt, sql } from 'drizzle-orm';

import type { ContactSubmissionTransaction } from '../../../../../application/ports/outbound/transactions/forms/contact-submission-transaction.port.js';
import type { ContactSubmissionUnitOfWork } from '../../../../../application/ports/outbound/transactions/forms/contact-submission-unit-of-work.port.js';
import type { ContactSubmission } from '../../../../../domain/value-objects/forms/contact-submission.value-object.js';
import {
  siteContactReceipts,
  siteContactSubmissions,
} from '../../schemas/forms/site-contact.schema.js';

type EnqueueContactDelivery = (scope: TransactionScope, submissionId: string) => Promise<void>;

interface PendingContactReceipt {
  // #region Properties
  /** Hashed operation key, content fingerprint and retention window. */
  readonly keyHash: string;
  readonly fingerprint: string;
  readonly retentionMs: number;
  readonly submissionId?: string;
  // #endregion
}

/** Commits a global contact submission, retry receipt and durable delivery intent together. */
export class SystemContactSubmissionUnitOfWork implements ContactSubmissionUnitOfWork {
  // #region Constructor
  /** Binds the system runner and the delivery producer on its live transaction. */
  public constructor(
    private readonly system: SystemTransactionRunner,
    private readonly enqueue: EnqueueContactDelivery,
  ) {}
  // #endregion

  // #region Methods
  /** Uses a fresh read after claiming the key to see any immediately preceding acceptance. */
  public run<T>(work: (transaction: ContactSubmissionTransaction) => Promise<T>): Promise<T> {
    return this.system.run(
      async (scope) => {
        const store = new ContactSubmissionStore(scope, this.enqueue);
        const result = await work(store);
        store.assertSettled();
        return result;
      },
      { isolationLevel: 'read committed' },
    );
  }
  // #endregion
}

class ContactSubmissionStore implements ContactSubmissionTransaction {
  // #region Properties
  /** The single receipt being assembled in this callback. */
  private pending: PendingContactReceipt | undefined;
  // #endregion

  // #region Constructor
  /** Uses one system transaction for both the message and its job. */
  public constructor(
    private readonly scope: TransactionScope,
    private readonly enqueue: EnqueueContactDelivery,
  ) {}
  // #endregion

  // #region Methods
  /** Claims the key immediately and looks up its unexpired fingerprint. */
  public async reserve(
    key: string,
    submission: ContactSubmission,
    retentionMs: number,
  ): ReturnType<ContactSubmissionTransaction['reserve']> {
    this.assertSettled();
    const keyHash = digest(key);
    const lock = await this.scope.db.execute<{ acquired: boolean }>(
      sql`select pg_try_advisory_xact_lock(hashtextextended('site-contact:' || ${keyHash}, 0)) as acquired`,
    );
    if (lock.rows[0]?.acquired !== true) return 'in-progress';

    const [receipt] = await this.scope.db
      .select({ fingerprint: siteContactReceipts.fingerprint })
      .from(siteContactReceipts)
      .where(
        and(
          eq(siteContactReceipts.keyHash, keyHash),
          gt(siteContactReceipts.expiresAt, sql`clock_timestamp()`),
        ),
      )
      .limit(1);

    const fingerprint = contactFingerprint(submission);
    if (receipt !== undefined)
      return receipt.fingerprint === fingerprint ? 'replayed' : 'key-reused';
    this.pending = { keyHash, fingerprint, retentionMs };
    return 'new';
  }

  /** Stores the exact reserved content and keeps the returned primary key in the transaction. */
  public async save(key: string, submission: ContactSubmission): Promise<string> {
    const pending = this.pending;
    if (
      pending === undefined ||
      pending.submissionId !== undefined ||
      pending.keyHash !== digest(key) ||
      pending.fingerprint !== contactFingerprint(submission)
    ) {
      throw new Error('Contact submission does not match the active reservation.');
    }
    const [saved] = await this.scope.db
      .insert(siteContactSubmissions)
      .values({
        replyTo: submission.replyTo().address(),
        subject: submission.subject(),
        message: { text: submission.message() },
      })
      .returning({ id: siteContactSubmissions.id });
    if (saved === undefined) throw new Error('Contact submission was not recorded.');
    this.pending = { ...pending, submissionId: saved.id };
    return saved.id;
  }

  /** Enqueues just the verified primary key and then seals the replay receipt. */
  public async enqueueDelivery(submissionId: string): Promise<void> {
    const pending = this.pending;
    if (pending?.submissionId !== submissionId) {
      throw new Error('Contact delivery does not belong to the active reservation.');
    }
    await this.enqueue(this.scope, submissionId);

    // Start the retention window at the final write of acceptance, after the delivery is admitted.
    const receipt = {
      fingerprint: pending.fingerprint,
      submissionId,
      expiresAt: sql`clock_timestamp() + ${pending.retentionMs} * interval '1 millisecond'`,
      createdAt: sql`clock_timestamp()`,
    };
    await this.scope.db
      .insert(siteContactReceipts)
      .values({ keyHash: pending.keyHash, ...receipt })
      .onConflictDoUpdate({ target: siteContactReceipts.keyHash, set: receipt });
    this.pending = undefined;
  }

  /** Prevents any callback from committing a partial acceptance. */
  public assertSettled(): void {
    if (this.pending !== undefined) throw new Error('A contact submission reservation is open.');
  }
  // #endregion
}

function digest(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

function contactFingerprint(submission: ContactSubmission): string {
  return digest(
    JSON.stringify([submission.replyTo().address(), submission.subject(), submission.message()]),
  );
}
