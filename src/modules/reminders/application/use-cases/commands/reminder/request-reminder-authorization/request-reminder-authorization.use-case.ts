import type { ReminderAuthorizationUnitOfWork } from '../../../../ports/outbound/transactions/reminder/reminder-authorization-unit-of-work.port.js';
import { ReminderAuthorizationExpired } from '../../../../models/reminder/reminder-authorization-expired.model.js';
import type { RequestReminderAuthorizationInput } from './request-reminder-authorization.input.js';
import type { RequestReminderAuthorizationOutput } from './request-reminder-authorization.output.js';

const MAX_RETRIES = 10;
const MAX_ATTEMPT_DURATION_MS = 30_000;

/** Stages one authorization attempt beside its transactional outbox request. */
export class RequestReminderAuthorization {
  // #region Constructor
  /** Binds the transactional persistence port. */
  public constructor(
    private readonly work: ReminderAuthorizationUnitOfWork,
    private readonly now: () => number,
  ) {}
  // #endregion

  // #region Methods
  /** Keeps live retries idempotent and replaces expired or superseded attempts. */
  public execute(
    input: RequestReminderAuthorizationInput,
  ): Promise<RequestReminderAuthorizationOutput> {
    if (
      !Number.isSafeInteger(input.expiresAt) ||
      !Number.isSafeInteger(input.retryCount) ||
      input.retryCount < 0 ||
      input.retryCount > MAX_RETRIES ||
      (input.retryCount === 0 && input.previousAttemptId !== null) ||
      (input.retryCount > 0 &&
        (typeof input.previousAttemptId !== 'string' || input.previousAttemptId.length === 0)) ||
      !Number.isSafeInteger(input.scheduleVersion) ||
      input.scheduleVersion < 1
    ) {
      throw new RangeError('Invalid reminder authorization attempt.');
    }
    return this.work.run(input.organizationId, async (store) => {
      const reminder = await store.lockReminder(
        input.organizationId,
        input.userId,
        input.reminderId,
      );
      if (reminder === null) return false;
      reminder.requireAccess(input.organizationId, input.userId, true);
      const current = await store.lockCurrentAttempt(input.organizationId, input.reminderId);
      if (input.previousAttemptId === null) {
        if (current?.scheduleVersion === input.scheduleVersion) return false;
      } else if (current?.id !== input.previousAttemptId) {
        return false;
      }
      const now = this.now();
      if (!Number.isSafeInteger(now)) throw new RangeError('Invalid reminder authorization clock.');
      if (reminder.fireIfDue(input.scheduleVersion, now).fact === null) return false;
      const state = reminder.snapshot;
      if (current?.status === 'denied' && current.scheduleVersion === state.scheduleVersion)
        return false;
      if (
        current !== null &&
        current.expiresAt > now &&
        current.reminderVersion === state.version &&
        current.scheduleVersion === state.scheduleVersion
      )
        return false;
      if (input.expiresAt <= now) throw new ReminderAuthorizationExpired();
      if (input.expiresAt - now > MAX_ATTEMPT_DURATION_MS)
        throw new RangeError('Reminder authorization expiry exceeds 30 seconds.');
      if (input.retryCount === MAX_RETRIES)
        throw new Error('Reminder authorization retries exhausted.');
      if (current?.status === 'pending')
        await store.finishAttempt(input.organizationId, current.id, 'expired');
      const attempt = {
        id: await store.allocateAttemptId(),
        organizationId: input.organizationId,
        reminderId: state.id,
        userId: state.userId,
        taskId: state.taskId,
        reminderVersion: state.version,
        scheduleVersion: state.scheduleVersion,
        expiresAt: input.expiresAt,
        status: 'pending' as const,
      };
      await store.requestAuthorization(attempt);
      await store.scheduleRetry({
        organizationId: input.organizationId,
        userId: state.userId,
        reminderId: state.id,
        scheduleVersion: state.scheduleVersion,
        attemptId: attempt.id,
        runAt: attempt.expiresAt,
        retryCount: input.retryCount + 1,
      });
      const beforeCommit = this.now();
      if (!Number.isSafeInteger(beforeCommit) || beforeCommit >= input.expiresAt)
        throw new ReminderAuthorizationExpired();
      return true;
    });
  }
  // #endregion
}
