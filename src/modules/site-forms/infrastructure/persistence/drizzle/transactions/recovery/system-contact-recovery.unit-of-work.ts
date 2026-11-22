import type { SystemTransactionRunner, TransactionScope } from '@cadenway/nest-common/database';
import { and, gt, inArray, lt, lte, notExists, sql } from 'drizzle-orm';

import type { ContactRecoveryTransaction } from '../../../../../application/ports/outbound/transactions/recovery/contact-recovery-transaction.port.js';
import type { ContactRecoveryUnitOfWork } from '../../../../../application/ports/outbound/transactions/recovery/contact-recovery-unit-of-work.port.js';
import { contactRetention } from '../../../../../domain/policies/forms/contact-retention.policy.js';
import {
  siteContactReceipts,
  siteContactSubmissions,
} from '../../schemas/forms/site-contact.schema.js';

type EnqueueContactRecovery = (scope: TransactionScope, submissionId: string) => Promise<void>;

/** Claims and requeues global Contact work with the transaction used by pg-boss. */
export class SystemContactRecoveryUnitOfWork implements ContactRecoveryUnitOfWork {
  // #region Constructor
  /** Receives the system runner and a producer bound to its live transaction scope. */
  public constructor(
    private readonly system: SystemTransactionRunner,
    private readonly enqueue: EnqueueContactRecovery,
  ) {}
  // #endregion

  // #region Methods
  /** Coordinates one bounded expiry or recovery operation. */
  public run(work: (transaction: ContactRecoveryTransaction) => Promise<void>): Promise<void> {
    return this.system.run((scope) =>
      work({
        pruneExpiredReceipts: (limit) => this.pruneExpiredReceipts(scope, limit),
        pruneExpiredSubmissions: (limit) => this.pruneExpiredSubmissions(scope, limit),
        requeueStaleSubmissions: (limit, inactiveHours) =>
          this.requeueStaleSubmissions(scope, limit, inactiveHours),
      }),
    );
  }

  /** Locks only expired receipt keys, so a concurrent acceptance can keep its new receipt. */
  private async pruneExpiredReceipts(scope: TransactionScope, limit: number): Promise<void> {
    const expired = scope.db
      .select({ keyHash: siteContactReceipts.keyHash })
      .from(siteContactReceipts)
      .where(lte(siteContactReceipts.expiresAt, sql`statement_timestamp()`))
      .orderBy(siteContactReceipts.expiresAt, siteContactReceipts.keyHash)
      .limit(limit)
      .for('update', { skipLocked: true });
    await scope.db.delete(siteContactReceipts).where(inArray(siteContactReceipts.keyHash, expired));
  }

  /** Keeps replay receipts valid and lets delivery and recovery skip rows already locked. */
  private async pruneExpiredSubmissions(scope: TransactionScope, limit: number): Promise<void> {
    const noReceipt = notExists(
      scope.db
        .select({ key: siteContactReceipts.keyHash })
        .from(siteContactReceipts)
        .where(sql`${siteContactReceipts.submissionId} = ${siteContactSubmissions.id}`),
    );
    const sent = scope.db
      .select({ id: siteContactSubmissions.id })
      .from(siteContactSubmissions)
      .where(
        and(
          sql`${siteContactSubmissions.status} = 'sent'`,
          lte(
            siteContactSubmissions.updatedAt,
            sql`statement_timestamp() - ${contactRetention.sentHours} * interval '1 hour'`,
          ),
          noReceipt,
        ),
      )
      .orderBy(siteContactSubmissions.updatedAt, siteContactSubmissions.id)
      .limit(limit)
      .for('update', { skipLocked: true });
    await scope.db.delete(siteContactSubmissions).where(inArray(siteContactSubmissions.id, sent));

    const undelivered = scope.db
      .select({ id: siteContactSubmissions.id })
      .from(siteContactSubmissions)
      .where(
        and(
          sql`${siteContactSubmissions.status} in ('pending', 'failed')`,
          lte(
            siteContactSubmissions.createdAt,
            sql`statement_timestamp() - ${contactRetention.undeliveredDays} * interval '1 day'`,
          ),
          noReceipt,
        ),
      )
      .orderBy(siteContactSubmissions.createdAt, siteContactSubmissions.id)
      .limit(limit)
      .for('update', { skipLocked: true });
    await scope.db
      .delete(siteContactSubmissions)
      .where(inArray(siteContactSubmissions.id, undelivered));
  }

  /** Reuses each delivery occurrence so a previously scheduled retry cannot be duplicated. */
  private async requeueStaleSubmissions(
    scope: TransactionScope,
    limit: number,
    inactiveHours: number,
  ): Promise<void> {
    const stale = await scope.db
      .select({ id: siteContactSubmissions.id })
      .from(siteContactSubmissions)
      .where(
        and(
          sql`${siteContactSubmissions.status} = 'pending'`,
          gt(
            siteContactSubmissions.createdAt,
            sql`statement_timestamp() - ${contactRetention.undeliveredDays} * interval '1 day'`,
          ),
          lt(
            siteContactSubmissions.updatedAt,
            sql`statement_timestamp() - ${inactiveHours} * interval '1 hour'`,
          ),
        ),
      )
      .orderBy(siteContactSubmissions.updatedAt, siteContactSubmissions.id)
      .limit(limit)
      .for('update', { skipLocked: true });

    if (stale.length === 0) return;
    for (const submission of stale) {
      await this.enqueue(scope, submission.id);
    }
    // Advance the whole inspected batch, including jobs still retained by the queue.
    await scope.db
      .update(siteContactSubmissions)
      .set({ updatedAt: sql`statement_timestamp()` })
      .where(
        inArray(
          siteContactSubmissions.id,
          stale.map(({ id }) => id),
        ),
      );
  }
  // #endregion
}
