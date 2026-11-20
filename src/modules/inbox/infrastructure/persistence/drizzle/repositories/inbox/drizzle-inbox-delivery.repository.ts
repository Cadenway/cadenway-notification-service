import type { TransactionScope } from '@cadenway/nest-common/database';
import { and, eq, inArray, sql } from 'drizzle-orm';

import type { InboxAuthorizationAttempt } from '../../../../../application/models/inbox/inbox-authorization-attempt.model.js';
import type { InboxAuthorizationRetry } from '../../../../../application/models/inbox/inbox-authorization-retry.model.js';
import type { InboxDeliveryCandidate } from '../../../../../application/models/inbox/inbox-delivery-candidate.model.js';
import type { InboxDeliveryStore } from '../../../../../application/ports/outbound/transactions/inbox/inbox-delivery-store.port.js';
import type { InboxNotification } from '../../../../../domain/aggregates/inbox/inbox-notification.aggregate.js';
import type { NotificationCreated } from '../../../../../domain/events/inbox/notification-created.event.js';
import { inboxDeliveryAuthorizationAttempts } from '../../schemas/inbox/inbox-delivery-authorization-attempts.schema.js';
import type { DrizzleInboxRecords } from './drizzle-inbox-records.repository.js';

const INSERT_BATCH_SIZE: number = 250;
type AttemptRow = typeof inboxDeliveryAuthorizationAttempts.$inferSelect;

/** Maps the persisted tenant and source binding without exposing it in a decision event. */
function toAttempt(row: AttemptRow): InboxAuthorizationAttempt {
  return {
    id: row.id,
    outcome: row.outcome,
    expiresAt: row.expiresAt.getTime(),
    candidate: {
      organizationId: row.organizationId,
      recipientId: row.recipientId,
      sourceEventId: row.sourceEventId,
      actorUserId: row.actorUserId,
      kind: row.kind,
      taskKey: row.taskKey,
      commentId: row.commentId,
      status: row.status,
    },
  };
}

/** Stages visibility requests and resolves them in the inbox's active transaction. */
export class DrizzleInboxDelivery implements InboxDeliveryStore {
  // #region Constructor
  /** Binds the tenant transaction and its scoped inbox, outbox and job writers. */
  public constructor(
    private readonly scope: TransactionScope,
    private readonly records: DrizzleInboxRecords,
    private readonly writeRequest: (attempt: InboxAuthorizationAttempt) => Promise<void>,
    private readonly scheduleRetry: (retry: InboxAuthorizationRetry) => Promise<void>,
  ) {}
  // #endregion

  // #region Methods
  /** Inserts distinct recipient attempts and writes requests for only the newly inserted rows. */
  public async stage(
    candidates: readonly InboxDeliveryCandidate[],
    expiresAt: number,
  ): Promise<number> {
    for (const candidate of candidates) this.requireTenant(candidate.organizationId);
    const deadline = new Date(expiresAt);
    let staged = 0;
    for (let index = 0; index < candidates.length; index += INSERT_BATCH_SIZE) {
      const values = candidates
        .slice(index, index + INSERT_BATCH_SIZE)
        .map((candidate) => ({ ...candidate, expiresAt: deadline }));
      const inserted = await this.scope.db
        .insert(inboxDeliveryAuthorizationAttempts)
        .values(values)
        .onConflictDoNothing({
          target: [
            inboxDeliveryAuthorizationAttempts.organizationId,
            inboxDeliveryAuthorizationAttempts.recipientId,
            inboxDeliveryAuthorizationAttempts.sourceEventId,
          ],
        })
        .returning();
      for (const row of inserted) await this.enqueueAttempt(row, 1);
      staged += inserted.length;
    }
    return staged;
  }

  /** Locks only the attempt that matches both the decision's tenant and correlation. */
  public async lockAttempt(
    organizationId: string,
    id: string,
  ): Promise<InboxAuthorizationAttempt | null> {
    this.requireTenant(organizationId);
    const [row] = await this.scope.db
      .select()
      .from(inboxDeliveryAuthorizationAttempts)
      .where(
        and(
          eq(inboxDeliveryAuthorizationAttempts.organizationId, organizationId),
          eq(inboxDeliveryAuthorizationAttempts.id, id),
        ),
      )
      .for('update');
    return row === undefined ? null : toAttempt(row);
  }

  /** Rotates the correlation on the locked row, preserving the source and recipient. */
  public async renewAttempt(
    organizationId: string,
    id: string,
    expiresAt: number,
    retryCount: number,
  ): Promise<void> {
    this.requireTenant(organizationId);
    const [row] = await this.scope.db
      .update(inboxDeliveryAuthorizationAttempts)
      .set({
        id: sql`uuidv7()`,
        expiresAt: new Date(expiresAt),
        outcome: 'pending',
        updatedAt: sql`clock_timestamp()`,
      })
      .where(
        and(
          eq(inboxDeliveryAuthorizationAttempts.organizationId, organizationId),
          eq(inboxDeliveryAuthorizationAttempts.id, id),
          inArray(inboxDeliveryAuthorizationAttempts.outcome, ['pending', 'expired']),
        ),
      )
      .returning();
    if (row === undefined) throw new Error('The locked inbox authorization attempt changed.');
    await this.enqueueAttempt(row, retryCount);
  }

  /** Uses the same transaction to allocate the new inbox record's identity. */
  public newNotificationId(organizationId: string): Promise<string> {
    return this.records.newId(organizationId);
  }

  /** Delegates to the inbox writer with the immutable selector and source identity. */
  public insertNotification(
    candidate: InboxDeliveryCandidate,
    notification: InboxNotification,
    fact: NotificationCreated,
  ): Promise<boolean> {
    return this.records.insert(
      candidate.organizationId,
      candidate.recipientId,
      candidate.sourceEventId,
      notification,
      fact,
      {
        subject: { kind: 'task-key', taskKey: candidate.taskKey },
        ...(candidate.commentId === null ? {} : { commentId: candidate.commentId }),
        ...(candidate.status === null ? {} : { status: candidate.status }),
      },
    );
  }

  /** Consumes a pending attempt exactly once in its locked transaction. */
  public async finishAttempt(
    organizationId: string,
    id: string,
    outcome: Exclude<InboxAuthorizationAttempt['outcome'], 'pending'>,
  ): Promise<void> {
    this.requireTenant(organizationId);
    const changed = await this.scope.db
      .update(inboxDeliveryAuthorizationAttempts)
      .set({ outcome, updatedAt: sql`clock_timestamp()` })
      .where(
        and(
          eq(inboxDeliveryAuthorizationAttempts.organizationId, organizationId),
          eq(inboxDeliveryAuthorizationAttempts.id, id),
          eq(inboxDeliveryAuthorizationAttempts.outcome, 'pending'),
        ),
      )
      .returning({ id: inboxDeliveryAuthorizationAttempts.id });
    if (changed.length !== 1) throw new Error('The locked inbox authorization attempt changed.');
  }

  /** Records the request and expiration check in the caller's transaction. */
  private async enqueueAttempt(row: AttemptRow, retryCount: number): Promise<void> {
    const attempt = toAttempt(row);
    await this.writeRequest(attempt);
    await this.scheduleRetry({
      organizationId: row.organizationId,
      attemptId: row.id,
      runAt: attempt.expiresAt,
      retryCount,
    });
  }

  /** Preserves explicit tenant scope even when the database enforces RLS. */
  private requireTenant(organizationId: string): void {
    if (this.scope.organizationId?.toLowerCase() !== organizationId.toLowerCase()) {
      throw new Error('Inbox authorization tenant scope does not match the active transaction.');
    }
  }
  // #endregion
}
