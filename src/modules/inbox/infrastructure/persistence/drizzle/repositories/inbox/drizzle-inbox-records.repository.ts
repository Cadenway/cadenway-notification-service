import type { TransactionScope } from '@cadenway/nest-common/database';
import { and, desc, eq, isNotNull, isNull, lt, or, sql } from 'drizzle-orm';

import type { InboxNotification } from '../../../../../domain/aggregates/inbox/inbox-notification.aggregate.js';
import { InboxGenerationChanged } from '../../../../../domain/errors/inbox/inbox-generation-changed.error.js';
import type { NotificationCreated } from '../../../../../domain/events/inbox/notification-created.event.js';
import { toInboxNotification } from '../../mappers/inbox/inbox-notification.mapper.js';
import { inboxNotifications } from '../../schemas/inbox/inbox-notifications.schema.js';
import { inboxGenerations } from '../../schemas/inbox/inbox-generations.schema.js';

interface Cursor {
  // #region Properties
  /** Timestamp of the last examined candidate. */
  readonly createdAt: Date;

  /** Tie-breaker of the last examined candidate. */
  readonly id: string;
  // #endregion
}
type State = 'active' | 'all' | 'unread' | 'archived';
type Subject =
  | { readonly kind: 'task-key'; readonly taskKey: string }
  | { readonly kind: 'task-id'; readonly taskId: string }
  | { readonly kind: 'space'; readonly spaceId: string }
  | { readonly kind: 'list'; readonly listId: string }
  | null;
type FactWriter = (fact: NotificationCreated, subject: Subject) => Promise<void>;

interface Details {
  // #region Properties
  /** Exact selector received from the event source. */
  readonly subject: Subject;

  /** Optional comment reference for later authorized enrichment. */
  readonly commentId?: string;

  /** Optional status from the source event. */
  readonly status?: string;
  // #endregion
}

function subjectColumns(subject: Subject): { kind: string | null; value: string | null } {
  if (subject === null) return { kind: null, value: null };
  switch (subject.kind) {
    case 'task-key':
      return { kind: subject.kind, value: subject.taskKey };
    case 'task-id':
      return { kind: subject.kind, value: subject.taskId.toLowerCase() };
    case 'space':
      return { kind: subject.kind, value: subject.spaceId.toLowerCase() };
    case 'list':
      return { kind: subject.kind, value: subject.listId.toLowerCase() };
  }
}

function subjectFromColumns(kind: string | null, value: string | null): Subject {
  if (kind === null && value === null) return null;
  if (value === null) throw new Error('Stored inbox subject is invalid.');
  switch (kind) {
    case 'task-key':
      return { kind, taskKey: value };
    case 'task-id':
      return { kind, taskId: value };
    case 'space':
      return { kind, spaceId: value };
    case 'list':
      return { kind, listId: value };
    default:
      throw new Error('Stored inbox subject is invalid.');
  }
}

function candidateRecord(row: typeof inboxNotifications.$inferSelect) {
  return {
    id: row.id,
    kind: row.kind,
    actorUserId: row.actorUserId,
    subject: subjectFromColumns(row.subjectKind, row.subjectValue),
    ...(row.commentId === null ? {} : { commentId: row.commentId }),
    ...(row.status === null ? {} : { status: row.status }),
    createdAt: row.createdAt.toISOString(),
    readAt: row.readAt?.toISOString() ?? null,
    archivedAt: row.archivedAt?.toISOString() ?? null,
    version: row.version,
  };
}

/** Raw bounded inbox records in an existing tenant transaction, prior to visibility checks. */
export class DrizzleInboxRecords {
  // #region Constructor
  /** Binds a live tenant transaction and its transactional outbox writer. */
  public constructor(
    private readonly scope: TransactionScope,
    private readonly writeFact: FactWriter,
  ) {}
  // #endregion

  // #region Methods
  /** Allocates an inbox ID with PostgreSQL before the domain creates its fact. */
  public async newId(organizationId: string): Promise<string> {
    this.requireScope(organizationId);
    const result = await this.scope.client.query('select uuidv7()::text as id');
    const row: unknown = result.rows[0];
    if (typeof row !== 'object' || row === null || !('id' in row) || typeof row.id !== 'string') {
      throw new Error('PostgreSQL did not return an inbox ID.');
    }
    return row.id;
  }

  /** Inserts a single event-recipient effect and records its fact in the same transaction. */
  public async insert(
    organizationId: string,
    recipientId: string,
    sourceEventId: string,
    item: InboxNotification,
    fact: NotificationCreated,
    details?: Details,
  ): Promise<boolean> {
    this.requireScope(organizationId, recipientId, item);
    const state = item.snapshot;
    if (state.actorUserId?.toLowerCase() === recipientId.toLowerCase()) return false;
    if (
      state.version !== 1 ||
      state.readAt !== null ||
      state.archivedAt !== null ||
      fact.notificationId !== state.id ||
      fact.organizationId !== state.organizationId ||
      fact.recipientId !== state.recipientId ||
      fact.createdAt !== state.createdAt
    )
      throw new Error('Invalid new inbox notification or fact.');
    const subject =
      details !== undefined
        ? details.subject
        : state.subject === null
          ? null
          : state.subject.kind === 'task'
            ? { kind: 'task-id' as const, taskId: state.subject.id }
            : state.subject.kind === 'space'
              ? { kind: 'space' as const, spaceId: state.subject.id }
              : { kind: 'list' as const, listId: state.subject.id };
    const columns = subjectColumns(subject);
    const generation = await this.lockGeneration(organizationId, recipientId);
    const createdAt = new Date(state.createdAt);
    const inserted = await this.scope.db
      .insert(inboxNotifications)
      .values({
        id: state.id,
        organizationId,
        recipientId,
        sourceEventId,
        kind: state.kind,
        actorUserId: state.actorUserId,
        subjectKind: columns.kind,
        subjectValue: columns.value,
        commentId: details?.commentId ?? null,
        status: details?.status ?? null,
        creationGeneration: generation + 1n,
        createdAt,
        updatedAt: createdAt,
        version: state.version,
      })
      .onConflictDoNothing({
        target: [
          inboxNotifications.organizationId,
          inboxNotifications.recipientId,
          inboxNotifications.sourceEventId,
        ],
      })
      .returning({ id: inboxNotifications.id });
    if (inserted.length === 0) return false;
    await this.advanceGeneration(organizationId, recipientId, generation);
    await this.writeFact(fact, subjectFromColumns(columns.kind, columns.value));
    return true;
  }

  /** Reads a bounded page in descending creation and ID order for subsequent authorization. */
  public async page(
    organizationId: string,
    recipientId: string,
    state: State,
    after: Cursor | null,
    limit: number,
  ): Promise<readonly InboxNotification[]> {
    this.requireScope(organizationId);
    if (!Number.isInteger(limit) || limit < 1 || limit > 500)
      throw new RangeError('Invalid inbox page size.');
    const filter =
      state === 'unread'
        ? and(isNull(inboxNotifications.readAt), isNull(inboxNotifications.archivedAt))
        : state === 'archived'
          ? isNotNull(inboxNotifications.archivedAt)
          : isNull(inboxNotifications.archivedAt);
    const rows = await this.scope.db
      .select()
      .from(inboxNotifications)
      .where(
        and(
          eq(inboxNotifications.organizationId, organizationId),
          eq(inboxNotifications.recipientId, recipientId),
          filter,
          after === null
            ? undefined
            : or(
                lt(inboxNotifications.createdAt, after.createdAt),
                and(
                  eq(inboxNotifications.createdAt, after.createdAt),
                  lt(inboxNotifications.id, after.id),
                ),
              ),
        ),
      )
      .orderBy(desc(inboxNotifications.createdAt), desc(inboxNotifications.id))
      .limit(limit);
    return rows.map(toInboxNotification);
  }

  /** Scans private candidate records for subsequent Task authorization and enrichment. */
  public async pageCandidates(
    organizationId: string,
    recipientId: string,
    state: State,
    after: Cursor | null,
    limit: number,
  ): Promise<
    readonly { readonly record: ReturnType<typeof candidateRecord>; readonly cursorAfter: Cursor }[]
  > {
    this.requireScope(organizationId);
    if (!Number.isInteger(limit) || limit < 1 || limit > 101)
      throw new RangeError('Invalid inbox page size.');
    const filter =
      state === 'unread'
        ? and(isNull(inboxNotifications.readAt), isNull(inboxNotifications.archivedAt))
        : state === 'archived'
          ? isNotNull(inboxNotifications.archivedAt)
          : isNull(inboxNotifications.archivedAt);
    const rows = await this.scope.db
      .select()
      .from(inboxNotifications)
      .where(
        and(
          eq(inboxNotifications.organizationId, organizationId),
          eq(inboxNotifications.recipientId, recipientId),
          filter,
          after === null
            ? undefined
            : or(
                lt(inboxNotifications.createdAt, after.createdAt),
                and(
                  eq(inboxNotifications.createdAt, after.createdAt),
                  lt(inboxNotifications.id, after.id),
                ),
              ),
        ),
      )
      .orderBy(desc(inboxNotifications.createdAt), desc(inboxNotifications.id))
      .limit(limit);
    return rows.map((row) => ({
      record: candidateRecord(row),
      cursorAfter: { createdAt: row.createdAt, id: row.id },
    }));
  }

  /** Returns the caller-owned candidate for a subsequent authorization decision. */
  public async findCandidate(
    organizationId: string,
    recipientId: string,
    id: string,
  ): Promise<ReturnType<typeof candidateRecord> | null> {
    this.requireScope(organizationId);
    const rows = await this.scope.db
      .select()
      .from(inboxNotifications)
      .where(
        and(
          eq(inboxNotifications.organizationId, organizationId),
          eq(inboxNotifications.recipientId, recipientId),
          eq(inboxNotifications.id, id),
        ),
      );
    return rows[0] === undefined ? null : candidateRecord(rows[0]);
  }

  /** Applies a checked read or archive after locking and matching the exact stored linkage. */
  public async change(
    organizationId: string,
    recipientId: string,
    id: string,
    subject: Subject,
    action: 'read' | 'archive',
    expectedVersions: readonly number[] | '*' | undefined,
    now: number,
  ): Promise<
    | { readonly kind: 'not-found' }
    | { readonly kind: 'version-mismatch'; readonly currentVersion: number }
    | { readonly kind: 'ok'; readonly record: ReturnType<typeof candidateRecord> }
  > {
    this.requireScope(organizationId);
    if (!Number.isSafeInteger(now)) throw new RangeError('Invalid inbox action time.');
    const generation = await this.lockGeneration(organizationId, recipientId);
    const rows = await this.scope.db
      .select()
      .from(inboxNotifications)
      .where(
        and(
          eq(inboxNotifications.organizationId, organizationId),
          eq(inboxNotifications.recipientId, recipientId),
          eq(inboxNotifications.id, id),
        ),
      )
      .for('update');
    const row = rows[0];
    const selected = subjectColumns(subject);
    if (row?.subjectKind !== selected.kind || row.subjectValue !== selected.value)
      return { kind: 'not-found' };
    if (
      expectedVersions !== undefined &&
      expectedVersions !== '*' &&
      !expectedVersions.includes(row.version)
    )
      return { kind: 'version-mismatch', currentVersion: row.version };
    if (action === 'read' ? row.readAt !== null : row.archivedAt !== null)
      return { kind: 'ok', record: candidateRecord(row) };
    const at = new Date(now);
    if (now < row.createdAt.getTime() || !Number.isFinite(at.getTime()))
      throw new RangeError('Invalid inbox action time.');
    const updated = await this.scope.db
      .update(inboxNotifications)
      .set({
        ...(action === 'read' ? { readAt: at } : { archivedAt: at }),
        updatedAt: at,
        version: row.version + 1,
      })
      .where(
        and(
          eq(inboxNotifications.organizationId, organizationId),
          eq(inboxNotifications.recipientId, recipientId),
          eq(inboxNotifications.id, id),
          eq(inboxNotifications.version, row.version),
        ),
      )
      .returning();
    if (updated[0] === undefined) throw new Error('Inbox record changed during its transaction.');
    await this.advanceGeneration(organizationId, recipientId, generation);
    return { kind: 'ok', record: candidateRecord(updated[0]) };
  }

  /** Reads the owner generation and unread groups in one read-only PostgreSQL snapshot. */
  public async unreadSubjects(
    organizationId: string,
    recipientId: string,
    expectedGeneration: string | null,
    after: { readonly kind: string; readonly value: string } | null,
    limit: number,
  ): Promise<{
    readonly generation: string;
    readonly items: readonly { readonly subject: Subject; readonly count: number }[];
    readonly next: { readonly kind: string; readonly value: string } | null;
  }> {
    this.requireScope(organizationId);
    if (!Number.isInteger(limit) || limit < 1 || limit > 100)
      throw new RangeError('Invalid inbox page size.');
    const expected = expectedGeneration === null ? null : this.parseGeneration(expectedGeneration);
    const cursor =
      after === null
        ? sql``
        : sql`and (coalesce(subject_kind, '') collate "C", coalesce(subject_value, '') collate "C") > (${after.kind}::text collate "C", ${after.value}::text collate "C")`;
    const result = await this.scope.db.execute<{
      generation: string;
      kind: string | null;
      value: string | null;
      total: string | null;
    }>(sql`
      with owner as (
        select coalesce((
          select generation from inbox_generations
          where organization_id = ${organizationId}::uuid and recipient_id = ${recipientId}::uuid
        ), 0)::text as generation
      )
      select owner.generation, grouped.kind, grouped.value, grouped.total
      from owner left join lateral (
        select subject_kind as kind, subject_value as value, count(*)::text as total
        from inbox_notifications
        where organization_id = ${organizationId}::uuid and recipient_id = ${recipientId}::uuid
          and read_at is null and archived_at is null ${cursor}
        group by subject_kind, subject_value
        order by coalesce(subject_kind, '') collate "C", coalesce(subject_value, '') collate "C"
        limit ${limit + 1}
      ) grouped on true
      order by coalesce(grouped.kind, '') collate "C", coalesce(grouped.value, '') collate "C"`);
    const first = result.rows[0];
    if (first === undefined) throw new Error('Inbox generation query returned no owner.');
    if (expected !== null && this.parseGeneration(first.generation) !== expected)
      throw new InboxGenerationChanged();
    const groups = result.rows.filter((row) => row.total !== null);
    const hasMore = groups.length > limit;
    const page = groups.slice(0, limit);
    const last = page.at(-1);
    return {
      generation: first.generation,
      items: page.map((row) => {
        const count = Number(row.total);
        if (!Number.isSafeInteger(count) || count < 1)
          throw new Error('Inbox unread count is out of range.');
        return { subject: subjectFromColumns(row.kind, row.value), count };
      }),
      next:
        hasMore && last !== undefined ? { kind: last.kind ?? '', value: last.value ?? '' } : null,
    };
  }

  /** Marks the authorized subject set through the original creation cutoff atomically. */
  public async readAll(
    organizationId: string,
    recipientId: string,
    snapshotGeneration: string,
    creationCutoff: string,
    authorizedSubjects: readonly Exclude<Subject, null>[],
    now: number,
  ): Promise<{ readonly markedRead: number; readonly unreadCount: number }> {
    this.requireScope(organizationId);
    const expected = this.parseGeneration(snapshotGeneration);
    const cutoff = this.parseGeneration(creationCutoff);
    if (
      cutoff > expected ||
      !Number.isSafeInteger(now) ||
      !Number.isFinite(new Date(now).getTime())
    )
      throw new RangeError('Invalid inbox read-all boundary.');
    const generation = await this.lockGeneration(organizationId, recipientId);
    if (generation !== expected) throw new InboxGenerationChanged();
    const subjects = JSON.stringify(authorizedSubjects.map(subjectColumns));
    const permitted = sql`(subject_kind is null or exists (
      select 1 from jsonb_to_recordset(${subjects}::jsonb) as allowed(kind text, value text)
      where allowed.kind = subject_kind and allowed.value = subject_value
    ))`;
    const changed = await this.scope.db.execute<{ total: string }>(sql`
      with updated as (
        update inbox_notifications set read_at = ${new Date(now)}, updated_at = ${new Date(now)}, version = version + 1
        where organization_id = ${organizationId}::uuid and recipient_id = ${recipientId}::uuid
          and read_at is null and archived_at is null and creation_generation <= ${cutoff}::bigint and ${permitted}
        returning 1
      ) select count(*)::text as total from updated`);
    const markedRead = Number(changed.rows[0]?.total);
    if (!Number.isSafeInteger(markedRead) || markedRead < 0)
      throw new Error('Inbox read count is out of range.');
    if (markedRead > 0) await this.advanceGeneration(organizationId, recipientId, generation);
    const remaining = await this.scope.db.execute<{ total: string }>(sql`
      select count(*)::text as total from inbox_notifications
      where organization_id = ${organizationId}::uuid and recipient_id = ${recipientId}::uuid
        and read_at is null and archived_at is null and ${permitted}`);
    const count = Number(remaining.rows[0]?.total);
    if (!Number.isSafeInteger(count) || count < 0)
      throw new Error('Inbox unread count is out of range.');
    return { markedRead, unreadCount: count };
  }

  /** Parses the public decimal form without allowing PostgreSQL bigint overflow. */
  private parseGeneration(value: string): bigint {
    if (!/^(0|[1-9][0-9]{0,18})$/u.test(value)) throw new RangeError('Invalid inbox generation.');
    const parsed = BigInt(value);
    if (parsed > 9223372036854775807n) throw new RangeError('Invalid inbox generation.');
    return parsed;
  }

  /** Reads a recipient-owned record, optionally locking it for a state transition. */
  public async find(
    organizationId: string,
    recipientId: string,
    id: string,
    lock: boolean,
  ): Promise<InboxNotification | null> {
    this.requireScope(organizationId);
    if (lock) await this.lockGeneration(organizationId, recipientId);
    const query = this.scope.db
      .select()
      .from(inboxNotifications)
      .where(
        and(
          eq(inboxNotifications.organizationId, organizationId),
          eq(inboxNotifications.recipientId, recipientId),
          eq(inboxNotifications.id, id),
        ),
      );
    const rows = await (lock ? query.for('update') : query);
    return rows[0] === undefined ? null : toInboxNotification(rows[0]);
  }

  /** Applies one already-authorized transition using a version compare-and-set. */
  public async save(
    organizationId: string,
    recipientId: string,
    item: InboxNotification,
  ): Promise<void> {
    this.requireScope(organizationId, recipientId, item);
    const state = item.snapshot;
    if (state.version < 2) throw new Error('An inbox transition must increment its version.');
    const generation = await this.lockGeneration(organizationId, recipientId);
    const updated = await this.scope.db
      .update(inboxNotifications)
      .set({
        readAt: state.readAt === null ? null : new Date(state.readAt),
        archivedAt: state.archivedAt === null ? null : new Date(state.archivedAt),
        updatedAt: new Date(Math.max(state.createdAt, state.readAt ?? 0, state.archivedAt ?? 0)),
        version: state.version,
      })
      .where(
        and(
          eq(inboxNotifications.organizationId, organizationId),
          eq(inboxNotifications.recipientId, recipientId),
          eq(inboxNotifications.id, state.id),
          eq(inboxNotifications.version, state.version - 1),
        ),
      )
      .returning({ id: inboxNotifications.id });
    if (updated.length !== 1) throw new Error('Inbox record changed during its transaction.');
    await this.advanceGeneration(organizationId, recipientId, generation);
  }

  /** Locks the owner's serialization row before taking individual notification locks. */
  private async lockGeneration(organizationId: string, recipientId: string): Promise<bigint> {
    await this.scope.db
      .insert(inboxGenerations)
      .values({ organizationId, recipientId })
      .onConflictDoNothing();
    const rows = await this.scope.db
      .select({ generation: inboxGenerations.generation })
      .from(inboxGenerations)
      .where(
        and(
          eq(inboxGenerations.organizationId, organizationId),
          eq(inboxGenerations.recipientId, recipientId),
        ),
      )
      .for('update');
    const row = rows[0];
    if (row === undefined) throw new Error('Inbox generation row is unavailable.');
    return row.generation;
  }

  /** Advances the owner's generation in the transaction containing its mutation. */
  private async advanceGeneration(
    organizationId: string,
    recipientId: string,
    generation: bigint,
  ): Promise<void> {
    const rows = await this.scope.db
      .update(inboxGenerations)
      .set({ generation: generation + 1n })
      .where(
        and(
          eq(inboxGenerations.organizationId, organizationId),
          eq(inboxGenerations.recipientId, recipientId),
          eq(inboxGenerations.generation, generation),
        ),
      )
      .returning({ generation: inboxGenerations.generation });
    if (rows.length !== 1) throw new Error('Inbox generation changed while locked.');
  }

  /** Checks the verified tenant before a statement or an outbox write. */
  private requireScope(
    organizationId: string,
    recipientId?: string,
    item?: InboxNotification,
  ): void {
    if (this.scope.organizationId?.toLowerCase() !== organizationId.toLowerCase()) {
      throw new Error('Inbox tenant scope does not match the active transaction.');
    }
    if (
      item !== undefined &&
      (item.snapshot.organizationId.toLowerCase() !== organizationId.toLowerCase() ||
        item.snapshot.recipientId.toLowerCase() !== recipientId?.toLowerCase())
    ) {
      throw new Error('Inbox recipient does not match the supplied record.');
    }
  }
  // #endregion
}
