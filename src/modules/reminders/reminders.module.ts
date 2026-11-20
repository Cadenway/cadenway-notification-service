import { TenantTransactionRunner } from '@cadenway/nest-common/database';
import { JobsService } from '@cadenway/nest-jobs';
import { Module } from '@nestjs/common';

import { REQUEST_REMINDER_AUTHORIZATION_QUEUE } from '../../config/job-queues.js';
import { CompleteReminder } from './application/use-cases/commands/reminder/complete-reminder/complete-reminder.use-case.js';
import { DeleteReminder } from './application/use-cases/commands/reminder/delete-reminder/delete-reminder.use-case.js';
import { SetTaskReminder } from './application/use-cases/commands/reminder/set-task-reminder/set-task-reminder.use-case.js';
import { SnoozeReminder } from './application/use-cases/commands/reminder/snooze-reminder/snooze-reminder.use-case.js';
import { UpdateReminderNote } from './application/use-cases/commands/reminder/update-reminder-note/update-reminder-note.use-case.js';
import { AcceptReminderAuthorization } from './application/use-cases/commands/reminder/accept-reminder-authorization/accept-reminder-authorization.use-case.js';
import { RequestReminderAuthorization } from './application/use-cases/commands/reminder/request-reminder-authorization/request-reminder-authorization.use-case.js';
import { GetReminderCandidate } from './application/use-cases/queries/reminder/get-reminder-candidate/get-reminder-candidate.use-case.js';
import { GetReminder } from './application/use-cases/queries/reminder/get-reminder/get-reminder.use-case.js';
import { GetTaskReminder } from './application/use-cases/queries/reminder/get-task-reminder/get-task-reminder.use-case.js';
import { ListReminderCandidates } from './application/use-cases/queries/reminder/list-reminder-candidates/list-reminder-candidates.use-case.js';
import { ListSelectedReminders } from './application/use-cases/queries/reminder/list-selected-reminders/list-selected-reminders.use-case.js';
import { ReminderDeliveryOutbox } from './infrastructure/messaging/outbox/reminder/reminder-delivery-outbox.adapter.js';
import { DrizzleReminderCandidatesReader } from './infrastructure/persistence/drizzle/repositories/reminder/drizzle-reminder-candidates.repository.js';
import { DrizzleReminderAuthorizationUnitOfWork } from './infrastructure/persistence/drizzle/transactions/reminder/drizzle-reminder-authorization.unit-of-work.js';
import { DrizzleRemindersUnitOfWork } from './infrastructure/persistence/drizzle/transactions/reminder/drizzle-reminders.unit-of-work.js';
import { RemindersController } from './presentation/http/controllers/reminder/reminders.controller.js';
import { RequestReminderAuthorizationHandler } from './presentation/jobs/handlers/reminder/request-reminder-authorization.handler.js';
import { ReminderAuthorizationHandler } from './presentation/messaging/handlers/task/reminder-authorization.handler.js';

/** Composition boundary for scheduling and delivering personal task reminders. */
@Module({
  controllers: [RemindersController],
  providers: [
    ReminderDeliveryOutbox,
    {
      provide: DrizzleReminderCandidatesReader,
      inject: [TenantTransactionRunner],
      useFactory: (runner: TenantTransactionRunner): DrizzleReminderCandidatesReader =>
        new DrizzleReminderCandidatesReader(runner),
    },
    {
      provide: DrizzleRemindersUnitOfWork,
      inject: [TenantTransactionRunner, JobsService],
      useFactory: (
        runner: TenantTransactionRunner,
        jobs: JobsService,
      ): DrizzleRemindersUnitOfWork =>
        new DrizzleRemindersUnitOfWork(runner, async (scope, reminder) => {
          const { id, userId, scheduleVersion, remindAt } = reminder.snapshot;
          await jobs.enqueue(
            scope,
            REQUEST_REMINDER_AUTHORIZATION_QUEUE,
            { reminderId: id, userId, scheduleVersion, retryCount: 0, previousAttemptId: null },
            { occurrenceKey: `${id}:${String(scheduleVersion)}`, startAfter: new Date(remindAt) },
          );
        }),
    },
    {
      provide: DrizzleReminderAuthorizationUnitOfWork,
      inject: [TenantTransactionRunner, ReminderDeliveryOutbox, JobsService],
      useFactory: (
        runner: TenantTransactionRunner,
        outbox: ReminderDeliveryOutbox,
        jobs: JobsService,
      ): DrizzleReminderAuthorizationUnitOfWork =>
        new DrizzleReminderAuthorizationUnitOfWork(
          runner,
          (scope, attempt) => outbox.recordRequest(scope, attempt),
          (scope, fact) => outbox.recordDue(scope, fact),
          async (scope, retry) => {
            const { reminderId, userId, scheduleVersion, retryCount, attemptId, runAt } = retry;
            await jobs.enqueue(
              scope,
              REQUEST_REMINDER_AUTHORIZATION_QUEUE,
              { reminderId, userId, scheduleVersion, retryCount, previousAttemptId: attemptId },
              { occurrenceKey: attemptId, startAfter: new Date(runAt) },
            );
          },
        ),
    },
    {
      provide: RequestReminderAuthorization,
      inject: [DrizzleReminderAuthorizationUnitOfWork],
      useFactory: (work: DrizzleReminderAuthorizationUnitOfWork): RequestReminderAuthorization =>
        new RequestReminderAuthorization(work, Date.now),
    },
    {
      provide: AcceptReminderAuthorization,
      inject: [DrizzleReminderAuthorizationUnitOfWork],
      useFactory: (work: DrizzleReminderAuthorizationUnitOfWork): AcceptReminderAuthorization =>
        new AcceptReminderAuthorization(work, Date.now),
    },
    {
      provide: CompleteReminder,
      inject: [DrizzleRemindersUnitOfWork],
      useFactory: (work: DrizzleRemindersUnitOfWork): CompleteReminder =>
        new CompleteReminder(work),
    },
    {
      provide: DeleteReminder,
      inject: [DrizzleRemindersUnitOfWork],
      useFactory: (work: DrizzleRemindersUnitOfWork): DeleteReminder => new DeleteReminder(work),
    },
    {
      provide: SetTaskReminder,
      inject: [DrizzleRemindersUnitOfWork],
      useFactory: (work: DrizzleRemindersUnitOfWork): SetTaskReminder => new SetTaskReminder(work),
    },
    {
      provide: SnoozeReminder,
      inject: [DrizzleRemindersUnitOfWork],
      useFactory: (work: DrizzleRemindersUnitOfWork): SnoozeReminder => new SnoozeReminder(work),
    },
    {
      provide: UpdateReminderNote,
      inject: [DrizzleRemindersUnitOfWork],
      useFactory: (work: DrizzleRemindersUnitOfWork): UpdateReminderNote =>
        new UpdateReminderNote(work),
    },
    {
      provide: GetReminderCandidate,
      inject: [DrizzleRemindersUnitOfWork],
      useFactory: (work: DrizzleRemindersUnitOfWork): GetReminderCandidate =>
        new GetReminderCandidate(work),
    },
    {
      provide: GetReminder,
      inject: [DrizzleRemindersUnitOfWork],
      useFactory: (work: DrizzleRemindersUnitOfWork): GetReminder => new GetReminder(work),
    },
    {
      provide: GetTaskReminder,
      inject: [DrizzleRemindersUnitOfWork],
      useFactory: (work: DrizzleRemindersUnitOfWork): GetTaskReminder => new GetTaskReminder(work),
    },
    {
      provide: ListReminderCandidates,
      inject: [DrizzleReminderCandidatesReader],
      useFactory: (work: DrizzleReminderCandidatesReader): ListReminderCandidates =>
        new ListReminderCandidates(work),
    },
    {
      provide: ListSelectedReminders,
      inject: [DrizzleReminderCandidatesReader],
      useFactory: (work: DrizzleReminderCandidatesReader): ListSelectedReminders =>
        new ListSelectedReminders(work),
    },
    ReminderAuthorizationHandler,
    {
      provide: RequestReminderAuthorizationHandler,
      inject: [JobsService, RequestReminderAuthorization],
      useFactory: (
        jobs: JobsService,
        request: RequestReminderAuthorization,
      ): RequestReminderAuthorizationHandler =>
        new RequestReminderAuthorizationHandler(
          jobs,
          request,
          REQUEST_REMINDER_AUTHORIZATION_QUEUE,
        ),
    },
  ],
})
export class RemindersModule {}
