import type {
  ReminderCandidatePage,
  ReminderCandidateReference,
  ReminderRecord,
  ReminderRecordBatch,
  ReminderRecordSelection,
} from '@cadenway/contracts/types/internal/notification-service';
import {
  GetReminderCandidateInternalParams,
  GetReminderInternalParams,
  GetReminderInternalQueryParams,
  GetTaskReminderInternalParams,
  ListRemindersInternalQueryParams,
  ListVisibleReminderRecordsInternalBody,
  SetTaskReminderInternalBody,
  UpdateReminderNoteInternalBody,
  SnoozeReminderInternalBody,
} from '@cadenway/contracts/validators/internal/notification-service';
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
import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  Patch,
  Post,
  Put,
  Query,
  Req,
  Res,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import { z } from 'zod';

import { GetReminder } from '../../../../application/use-cases/queries/reminder/get-reminder/get-reminder.use-case.js';
import type { GetReminderOutput } from '../../../../application/use-cases/queries/reminder/get-reminder/get-reminder.output.js';
import { GetReminderCandidate } from '../../../../application/use-cases/queries/reminder/get-reminder-candidate/get-reminder-candidate.use-case.js';
import { GetTaskReminder } from '../../../../application/use-cases/queries/reminder/get-task-reminder/get-task-reminder.use-case.js';
import { ListReminderCandidates } from '../../../../application/use-cases/queries/reminder/list-reminder-candidates/list-reminder-candidates.use-case.js';
import { ListSelectedReminders } from '../../../../application/use-cases/queries/reminder/list-selected-reminders/list-selected-reminders.use-case.js';
import { SetTaskReminder } from '../../../../application/use-cases/commands/reminder/set-task-reminder/set-task-reminder.use-case.js';
import { UpdateReminderNote } from '../../../../application/use-cases/commands/reminder/update-reminder-note/update-reminder-note.use-case.js';
import { SnoozeReminder } from '../../../../application/use-cases/commands/reminder/snooze-reminder/snooze-reminder.use-case.js';
import { CompleteReminder } from '../../../../application/use-cases/commands/reminder/complete-reminder/complete-reminder.use-case.js';
import { DeleteReminder } from '../../../../application/use-cases/commands/reminder/delete-reminder/delete-reminder.use-case.js';
import { reminderRefusal } from '../../../../application/models/reminder/reminder-refusal.model.js';
import { ReminderGenerationChanged } from '../../../../application/models/reminder/reminder-generation-changed.model.js';

/** The caller and tenant established by the internal token. */
function scope(request: Request): { organizationId: string; userId: string } {
  const principal = principalOf(request);
  if (
    principal?.actor.type !== 'user' ||
    principal.actor.id === null ||
    principal.organizationId === null
  ) {
    throw new ProblemException({
      status: 401,
      code: 'auth.token-invalid',
      detail: 'The caller identity is unavailable.',
    });
  }
  return { organizationId: principal.organizationId, userId: principal.actor.id };
}

/** Projects the private reminder representation declared in the contract. */
function representation(record: GetReminderOutput): ReminderRecord {
  return {
    id: record.id,
    taskId: record.taskId,
    remindAt: new Date(record.remindAt).toISOString(),
    note: record.note,
    firedAt: record.firedAt === null ? null : new Date(record.firedAt).toISOString(),
    completedAt: record.completedAt === null ? null : new Date(record.completedAt).toISOString(),
    version: record.version,
  };
}

/** Refuses malformed or out-of-range generations before they reach PostgreSQL. */
function generation(value: string, source: 'query' | 'body'): string {
  if (!/^(0|[1-9][0-9]{0,18})$/u.test(value) || BigInt(value) > 9223372036854775807n) {
    throw new ProblemException({
      status: 400,
      code: 'request.invalid',
      detail: 'The request does not match its contract.',
      details: {
        issues: [
          source === 'body'
            ? { in: 'body', path: 'snapshotGeneration', code: 'invalid_generation' }
            : { in: 'query', path: 'cursor', code: 'invalid_cursor' },
        ],
      },
    });
  }
  return value;
}

/** Maps authorized domain refusals to the published internal problem codes. */
async function answer<T>(work: Promise<T>, response?: Response): Promise<T> {
  try {
    return await work;
  } catch (error: unknown) {
    if (error instanceof ReminderGenerationChanged) {
      throw new ProblemException({
        status: 409,
        code: 'reminder.generation-changed',
        detail: 'The reminder list changed.',
      });
    }
    const refusal = reminderRefusal(error);
    if (refusal === null) throw error;
    if (refusal.code === 'request.version-mismatch' && refusal.currentVersion !== null) {
      response?.setHeader('ETag', formatEtag(refusal.currentVersion));
      throw new ProblemException({
        status: 412,
        code: refusal.code,
        detail: 'The reminder changed.',
        details: { version: refusal.currentVersion },
      });
    }
    throw new ProblemException({
      status: refusal.status,
      code: refusal.code,
      detail: 'The reminder request was refused.',
    });
  }
}

/** Internal reminder reads use the identity and organization of the gateway token. */
@Controller('internal/v1')
@InternalAccess({ issuers: ['api-gateway'], actors: ['user'], organization: 'required' })
export class RemindersController {
  // #region Constructor
  /** Binds owner-scoped reads to their application use cases. */
  public constructor(
    private readonly listCandidates: ListReminderCandidates,
    private readonly listSelected: ListSelectedReminders,
    private readonly getCandidate: GetReminderCandidate,
    private readonly getReminder: GetReminder,
    private readonly getTaskReminder: GetTaskReminder,
    private readonly setTaskReminder: SetTaskReminder,
    private readonly updateNote: UpdateReminderNote,
    private readonly snoozeReminder: SnoozeReminder,
    private readonly completeReminder: CompleteReminder,
    private readonly deleteReminder: DeleteReminder,
  ) {}
  // #endregion

  // #region Methods
  /** Scans pending candidates with an owner- and generation-bound continuation. */
  @Get('reminders')
  public async list(
    @Req() request: Request,
    @Query(new ZodValidationPipe(ListRemindersInternalQueryParams.strict()))
    query: { cursor?: string; limit: number },
  ): Promise<ReminderCandidatePage> {
    const owner = scope(request);
    const filters = { ...owner, list: 'reminder-candidates' };
    let after: { remindAt: number; id: string } | null = null;
    let expectedGeneration: string | null = null;
    if (query.cursor !== undefined) {
      const position = decodeCursor(query.cursor, filters);
      const checked = z.tuple([z.iso.datetime(), z.string()]).safeParse(position.sort);
      const id = z.uuid().safeParse(position.id);
      if (!checked.success || !id.success) {
        throw new ProblemException({
          status: 400,
          code: 'request.invalid',
          detail: 'The request does not match its contract.',
          details: { issues: [{ in: 'query', path: 'cursor', code: 'invalid_cursor' }] },
        });
      }
      expectedGeneration = generation(checked.data[1], 'query');
      after = { remindAt: Date.parse(checked.data[0]), id: id.data };
    }
    const page = await answer(
      this.listCandidates.execute({
        ...owner,
        expectedGeneration,
        after,
        limit: query.limit,
      }),
    );
    const items = page.items.map((item) => ({
      id: item.id,
      taskId: item.taskId,
      remindAt: new Date(item.remindAt).toISOString(),
      cursorAfter: encodeCursor(
        { id: item.id, sort: [new Date(item.remindAt).toISOString(), page.generation] },
        filters,
      ),
    }));
    delete request.headers['if-none-match'];
    delete request.headers['if-modified-since'];
    return {
      generation: page.generation,
      items,
      nextCursor: page.hasMore ? (items.at(-1)?.cursorAfter ?? null) : null,
    };
  }

  /** Rechecks the sampled generation and returns only the selected exact pairs. */
  @Post('reminders/visible')
  @HttpCode(200)
  public async visible(
    @Req() request: Request,
    @Body(new ZodValidationPipe(ListVisibleReminderRecordsInternalBody))
    body: ReminderRecordSelection,
  ): Promise<ReminderRecordBatch> {
    const records = await answer(
      this.listSelected.execute({
        ...scope(request),
        expectedGeneration: generation(body.snapshotGeneration, 'body'),
        pairs: body.items,
      }),
    );
    return { items: records.map(representation) };
  }

  /** Reads a reminder-to-task link before the gateway checks Task visibility. */
  @Get('reminders/:reminderId/candidate')
  public async candidate(
    @Req() request: Request,
    @Param(new ZodValidationPipe(GetReminderCandidateInternalParams.strict()))
    params: { reminderId: string },
  ): Promise<ReminderCandidateReference> {
    const result = await answer(
      this.getCandidate.execute({ ...scope(request), id: params.reminderId }),
    );
    delete request.headers['if-none-match'];
    delete request.headers['if-modified-since'];
    return result;
  }

  /** Reads an owned reminder whose task binding was checked by the gateway. */
  @Get('reminders/:reminderId')
  public async get(
    @Req() request: Request,
    @Param(new ZodValidationPipe(GetReminderInternalParams.strict()))
    params: { reminderId: string },
    @Query(new ZodValidationPipe(GetReminderInternalQueryParams.strict()))
    query: { authorizedTaskId: string },
  ): Promise<ReminderRecord> {
    const result = await answer(
      this.getReminder.execute({
        ...scope(request),
        id: params.reminderId,
        authorizedTaskId: query.authorizedTaskId,
      }),
    );
    delete request.headers['if-none-match'];
    delete request.headers['if-modified-since'];
    return representation(result);
  }

  /** Reads the current pending reminder for an authorized task. */
  @Get('tasks/:taskId/reminder')
  public async getTask(
    @Req() request: Request,
    @Param(new ZodValidationPipe(GetTaskReminderInternalParams.strict()))
    params: { taskId: string },
  ): Promise<ReminderRecord> {
    const result = await answer(
      this.getTaskReminder.execute({ ...scope(request), taskId: params.taskId }),
    );
    delete request.headers['if-none-match'];
    delete request.headers['if-modified-since'];
    return representation(result);
  }

  /** Creates or reschedules the pending reminder for an authorized task. */
  @Put('tasks/:taskId/reminder')
  public async setTask(
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
    @Param(new ZodValidationPipe(GetTaskReminderInternalParams.strict()))
    params: { taskId: string },
    @IfMatch() condition: IfMatchCondition,
    @Body(new ZodValidationPipe(SetTaskReminderInternalBody))
    body: { remindAt: string; note?: string | null },
  ): Promise<ReminderRecord> {
    const result = await answer(
      this.setTaskReminder.execute({
        ...scope(request),
        taskId: params.taskId,
        remindAt: Date.parse(body.remindAt),
        note: body.note ?? null,
        now: Date.now(),
        ...(condition === undefined ? {} : { expectedVersions: condition }),
      }),
      response,
    );
    if (result.created) {
      response.status(201);
      response.setHeader('Location', `/internal/v1/reminders/${result.reminder.id}`);
    }
    return representation(result.reminder);
  }

  /** Updates the note after checking the authorized task binding. */
  @Patch('reminders/:reminderId')
  public async patch(
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
    @Param(new ZodValidationPipe(GetReminderInternalParams.strict()))
    params: { reminderId: string },
    @Query(new ZodValidationPipe(GetReminderInternalQueryParams.strict()))
    query: { authorizedTaskId: string },
    @IfMatch() condition: IfMatchCondition,
    @Body(new ZodValidationPipe(UpdateReminderNoteInternalBody)) body: { note: string | null },
  ): Promise<ReminderRecord> {
    return representation(
      await answer(
        this.updateNote.execute({
          ...scope(request),
          id: params.reminderId,
          authorizedTaskId: query.authorizedTaskId,
          note: body.note,
          ...(condition === undefined ? {} : { expectedVersions: condition }),
        }),
        response,
      ),
    );
  }

  /** Postpones an authorized pending reminder. */
  @Post('reminders/:reminderId/snooze')
  @HttpCode(200)
  public async snooze(
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
    @Param(new ZodValidationPipe(GetReminderInternalParams.strict()))
    params: { reminderId: string },
    @Query(new ZodValidationPipe(GetReminderInternalQueryParams.strict()))
    query: { authorizedTaskId: string },
    @IfMatch() condition: IfMatchCondition,
    @Body(new ZodValidationPipe(SnoozeReminderInternalBody)) body: { remindAt: string },
  ): Promise<ReminderRecord> {
    return representation(
      await answer(
        this.snoozeReminder.execute({
          ...scope(request),
          id: params.reminderId,
          authorizedTaskId: query.authorizedTaskId,
          remindAt: Date.parse(body.remindAt),
          now: Date.now(),
          ...(condition === undefined ? {} : { expectedVersions: condition }),
        }),
        response,
      ),
    );
  }

  /** Completes an authorized reminder. */
  @Post('reminders/:reminderId/complete')
  @HttpCode(200)
  public async complete(
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
    @Param(new ZodValidationPipe(GetReminderInternalParams.strict()))
    params: { reminderId: string },
    @Query(new ZodValidationPipe(GetReminderInternalQueryParams.strict()))
    query: { authorizedTaskId: string },
    @IfMatch() condition: IfMatchCondition,
  ): Promise<ReminderRecord> {
    return representation(
      await answer(
        this.completeReminder.execute({
          ...scope(request),
          id: params.reminderId,
          authorizedTaskId: query.authorizedTaskId,
          now: Date.now(),
          ...(condition === undefined ? {} : { expectedVersions: condition }),
        }),
        response,
      ),
    );
  }

  /** Removes an authorized reminder and its pending schedule. */
  @Delete('reminders/:reminderId')
  @HttpCode(204)
  public async delete(
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
    @Param(new ZodValidationPipe(GetReminderInternalParams.strict()))
    params: { reminderId: string },
    @Query(new ZodValidationPipe(GetReminderInternalQueryParams.strict()))
    query: { authorizedTaskId: string },
    @IfMatch() condition: IfMatchCondition,
  ): Promise<void> {
    await answer(
      this.deleteReminder.execute({
        ...scope(request),
        id: params.reminderId,
        authorizedTaskId: query.authorizedTaskId,
        ...(condition === undefined ? {} : { expectedVersions: condition }),
      }),
      response,
    );
  }
  // #endregion
}
