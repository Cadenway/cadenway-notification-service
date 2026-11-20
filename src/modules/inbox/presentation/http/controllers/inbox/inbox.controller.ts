import {
  decodeCursor,
  encodeCursor,
  formatEtag,
  IfMatch,
  InternalAccess,
  principalOf,
  ProblemException,
  ZodValidationPipe,
} from '@cadenway/nest-common';
import type { IfMatchCondition } from '@cadenway/nest-common';
import type {
  InboxCandidatePage,
  InboxCandidateReference,
  InboxReadAllResult,
  InboxReadAllSelection,
  InboxRecord,
  InboxSubjectBinding,
  InboxUnreadSubjectPage,
  ListInboxNotificationsInternalParams,
  ListInboxUnreadSubjectsInternalParams,
} from '@cadenway/contracts/types/internal/notification-service';
import {
  ArchiveInboxNotificationInternalBody,
  GetInboxNotificationCandidateInternalParams,
  ListInboxNotificationsInternalQueryParams,
  ListInboxNotificationsInternalResponse,
  ListInboxUnreadSubjectsInternalQueryParams,
  MarkInboxNotificationReadInternalBody,
  MarkInboxNotificationReadInternalResponse,
  MarkInboxNotificationsReadInternalBody,
} from '@cadenway/contracts/validators/internal/notification-service';
import { Body, Controller, Get, HttpCode, Param, Post, Query, Req, Res } from '@nestjs/common';
import type { Request, Response } from 'express';

import type { InboxCandidatePosition } from '../../../../application/models/inbox/inbox-candidate-position.model.js';
import type { InboxCheckedChangeResult } from '../../../../application/models/inbox/inbox-checked-change-result.model.js';
import { InboxGenerationChanged } from '../../../../application/models/inbox/inbox-generation-changed.model.js';
import { ArchiveCheckedNotification } from '../../../../application/use-cases/commands/inbox/archive-checked-notification/archive-checked-notification.use-case.js';
import { ReadCheckedNotification } from '../../../../application/use-cases/commands/inbox/read-checked-notification/read-checked-notification.use-case.js';
import { ReadSelectedNotifications } from '../../../../application/use-cases/commands/inbox/read-selected-notifications/read-selected-notifications.use-case.js';
import { GetInboxCandidate } from '../../../../application/use-cases/queries/inbox/get-inbox-candidate/get-inbox-candidate.use-case.js';
import { ListInboxCandidates } from '../../../../application/use-cases/queries/inbox/list-inbox-candidates/list-inbox-candidates.use-case.js';
import { ListUnreadSubjects } from '../../../../application/use-cases/queries/inbox/list-unread-subjects/list-unread-subjects.use-case.js';

/** Tenant and recipient from the verified internal principal. */
function scope(request: Request): { organizationId: string; recipientId: string } {
  const principal = principalOf(request);
  if (
    principal?.actor.type !== 'user' ||
    principal.actor.id === null ||
    principal.organizationId === null
  ) {
    throw new ProblemException({
      status: 401,
      code: 'auth.token-invalid',
      detail: 'The account or organization identity is unavailable.',
    });
  }
  return { organizationId: principal.organizationId, recipientId: principal.actor.id };
}

/** Answers a malformed cursor without exposing its contents. */
function invalidCursor(): never {
  throw new ProblemException({
    status: 400,
    code: 'request.invalid',
    detail: 'The request does not match its contract.',
    details: {
      issues: [{ in: 'query', path: 'cursor', code: 'invalid_cursor' }],
    },
  });
}

/** Converts the owner-generation conflict into the private API problem. */
async function withGeneration<T>(work: Promise<T>): Promise<T> {
  try {
    return await work;
  } catch (error) {
    if (!(error instanceof InboxGenerationChanged)) throw error;
    throw new ProblemException({
      status: 409,
      code: 'notification.inbox-generation-changed',
      detail: 'The inbox changed during its scan.',
    });
  }
}

/** Reads the position encoded for the current recipient and state filter. */
function candidatePosition(cursor: string, filters: object): InboxCandidatePosition {
  const position = decodeCursor(cursor, filters);
  const instant = position.sort[0];
  if (
    position.sort.length !== 1 ||
    typeof instant !== 'string' ||
    !Number.isFinite(Date.parse(instant)) ||
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu.test(position.id)
  )
    return invalidCursor();
  return { createdAt: new Date(instant), id: position.id };
}

/** Maps a checked write after the repository has applied linkage and version checks. */
function checkedRecord(result: InboxCheckedChangeResult, response: Response): InboxRecord {
  if (result.kind === 'not-found') {
    throw new ProblemException({
      status: 404,
      code: 'notification.not-found',
      detail: 'The notification was not found.',
    });
  }
  if (result.kind === 'version-mismatch') {
    response.setHeader('ETag', formatEtag(result.currentVersion));
    throw new ProblemException({
      status: 412,
      code: 'request.version-mismatch',
      detail: 'The notification changed since it was read.',
      details: { version: result.currentVersion },
    });
  }
  response.setHeader('ETag', formatEtag(result.record.version));
  return MarkInboxNotificationReadInternalResponse.parse(result.record);
}

/** Internal inbox candidates and checked transitions for the authenticated gateway user. */
@Controller('internal/v1/inbox')
@InternalAccess({ issuers: ['api-gateway'], actors: ['user'], organization: 'required' })
export class InboxController {
  // #region Constructor
  /** Binds the private reads and atomic checked updates. */
  public constructor(
    private readonly candidates: ListInboxCandidates,
    private readonly candidate: GetInboxCandidate,
    private readonly unread: ListUnreadSubjects,
    private readonly read: ReadCheckedNotification,
    private readonly archive: ArchiveCheckedNotification,
    private readonly readSelected: ReadSelectedNotifications,
  ) {}
  // #endregion

  // #region Methods
  /** Scans recipient-owned candidates without exposing them publicly. */
  @Get('notifications')
  public async list(
    @Req() request: Request,
    @Query(new ZodValidationPipe(ListInboxNotificationsInternalQueryParams))
    query: ListInboxNotificationsInternalParams,
  ): Promise<InboxCandidatePage> {
    const owner = scope(request);
    const state = query.state ?? 'active';
    const filters = { ...owner, state, resource: 'inbox-candidates' };
    const page = await this.candidates.execute({
      ...owner,
      state,
      limit: query.limit ?? 50,
      after: query.cursor === undefined ? null : candidatePosition(query.cursor, filters),
    });
    const cursor = (position: InboxCandidatePosition): string =>
      encodeCursor({ sort: [position.createdAt.toISOString()], id: position.id }, filters);
    delete request.headers['if-none-match'];
    delete request.headers['if-modified-since'];
    return ListInboxNotificationsInternalResponse.parse({
      items: page.items.map((item) => ({
        record: item.record,
        cursorAfter: cursor(item.cursorAfter),
      })),
      nextCursor: page.next === null ? null : cursor(page.next),
    });
  }

  /** Scans exact unread subject weights at the cursor's owner generation. */
  @Get('unread-subjects')
  public async listUnread(
    @Req() request: Request,
    @Query(new ZodValidationPipe(ListInboxUnreadSubjectsInternalQueryParams))
    query: ListInboxUnreadSubjectsInternalParams,
  ): Promise<InboxUnreadSubjectPage> {
    const owner = scope(request);
    const filters = { ...owner, resource: 'inbox-unread-subjects' };
    let expectedGeneration: string | null = null;
    let after: { kind: string; value: string } | null = null;
    if (query.cursor !== undefined) {
      const cursor = decodeCursor(query.cursor, filters);
      const [generation, kind, value] = cursor.sort;
      if (
        cursor.id !== 'subjects' ||
        cursor.sort.length !== 3 ||
        typeof generation !== 'string' ||
        !/^(0|[1-9][0-9]{0,18})$/u.test(generation) ||
        BigInt(generation) > 9223372036854775807n ||
        typeof kind !== 'string' ||
        typeof value !== 'string' ||
        !['', 'task-id', 'task-key', 'space', 'list'].includes(kind) ||
        (kind === '') !== (value === '')
      )
        return invalidCursor();
      expectedGeneration = generation;
      after = { kind, value };
    }
    const result = await withGeneration(
      this.unread.execute({
        ...owner,
        expectedGeneration,
        after,
        limit: query.limit ?? 50,
      }),
    );
    delete request.headers['if-none-match'];
    delete request.headers['if-modified-since'];
    return {
      generation: result.generation,
      items: [...result.items],
      nextCursor:
        result.next === null
          ? null
          : encodeCursor(
              { sort: [result.generation, result.next.kind, result.next.value], id: 'subjects' },
              filters,
            ),
    };
  }

  /** Resolves only the linkage needed for a current visibility check. */
  @Get('notifications/:notificationId')
  public async get(
    @Req() request: Request,
    @Param(new ZodValidationPipe(GetInboxNotificationCandidateInternalParams))
    params: { notificationId: string },
  ): Promise<InboxCandidateReference> {
    const result = await this.candidate.execute({ ...scope(request), ...params });
    if (result === null) {
      throw new ProblemException({
        status: 404,
        code: 'notification.not-found',
        detail: 'The notification was not found.',
      });
    }
    delete request.headers['if-none-match'];
    delete request.headers['if-modified-since'];
    return result;
  }

  /** Marks an already authorized selection as read through the fixed creation cutoff. */
  @Post('notifications/read-all')
  @HttpCode(200)
  public async readAll(
    @Req() request: Request,
    @Body(new ZodValidationPipe(MarkInboxNotificationsReadInternalBody))
    body: InboxReadAllSelection,
  ): Promise<InboxReadAllResult> {
    const snapshot = BigInt(body.snapshotGeneration);
    const cutoff = BigInt(body.creationCutoff);
    const issues = [];
    if (snapshot > 9223372036854775807n) {
      issues.push({ in: 'body', path: 'snapshotGeneration', code: 'invalid_generation' });
    }
    if (cutoff > 9223372036854775807n || cutoff > snapshot) {
      issues.push({ in: 'body', path: 'creationCutoff', code: 'invalid_cutoff' });
    }
    if (issues.length > 0) {
      throw new ProblemException({
        status: 400,
        code: 'request.invalid',
        detail: 'The request does not match its contract.',
        details: { issues },
      });
    }
    return withGeneration(this.readSelected.execute({ ...scope(request), ...body }));
  }

  /** Reads one notification after checking its exact authorized linkage. */
  @Post('notifications/:notificationId/read')
  @HttpCode(200)
  public async markRead(
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
    @Param(new ZodValidationPipe(GetInboxNotificationCandidateInternalParams))
    params: { notificationId: string },
    @IfMatch() expectedVersions: IfMatchCondition,
    @Body(new ZodValidationPipe(MarkInboxNotificationReadInternalBody)) body: InboxSubjectBinding,
  ): Promise<InboxRecord> {
    return checkedRecord(
      await this.read.execute({ ...scope(request), ...params, ...body, expectedVersions }),
      response,
    );
  }

  /** Archives one notification after checking its exact authorized linkage. */
  @Post('notifications/:notificationId/archive')
  @HttpCode(200)
  public async markArchived(
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
    @Param(new ZodValidationPipe(GetInboxNotificationCandidateInternalParams))
    params: { notificationId: string },
    @IfMatch() expectedVersions: IfMatchCondition,
    @Body(new ZodValidationPipe(ArchiveInboxNotificationInternalBody)) body: InboxSubjectBinding,
  ): Promise<InboxRecord> {
    return checkedRecord(
      await this.archive.execute({ ...scope(request), ...params, ...body, expectedVersions }),
      response,
    );
  }
  // #endregion
}
