import type { ReminderAuthorizationUnitOfWork } from '../../../../ports/outbound/transactions/reminder/reminder-authorization-unit-of-work.port.js';
import { ReminderAuthorizationExpired } from '../../../../models/reminder/reminder-authorization-expired.model.js';
import type { AcceptReminderAuthorizationInput } from './accept-reminder-authorization.input.js';
import type { AcceptReminderAuthorizationOutput } from './accept-reminder-authorization.output.js';

/** Consumes a live Task decision and records the due fact atomically. */
export class AcceptReminderAuthorization {
  // #region Constructor
  /** Binds the transactional persistence port. */
  public constructor(
    private readonly work: ReminderAuthorizationUnitOfWork,
    private readonly now: () => number,
  ) {}
  // #endregion

  // #region Methods
  /** Rechecks the exact locked reminder generation before accepting a permit. */
  public execute(
    input: AcceptReminderAuthorizationInput,
  ): Promise<AcceptReminderAuthorizationOutput> {
    return this.work.run(input.organizationId, async (store) => {
      const locator = await store.findAttempt(input.organizationId, input.attemptId);
      if (locator?.organizationId !== input.organizationId) return false;
      const reminder = await store.lockReminder(
        input.organizationId,
        locator.userId,
        locator.reminderId,
      );
      if (reminder === null) return false;
      const attempt = await store.lockCurrentAttempt(input.organizationId, locator.reminderId);
      if (attempt?.id !== input.attemptId || attempt.status !== 'pending') return false;
      const now = this.now();
      const state = reminder.snapshot;
      if (
        attempt.organizationId !== input.organizationId ||
        attempt.userId !== state.userId ||
        attempt.taskId !== state.taskId ||
        attempt.reminderId !== state.id ||
        attempt.reminderVersion !== state.version ||
        attempt.scheduleVersion !== state.scheduleVersion
      )
        return false;
      if (
        !Number.isSafeInteger(now) ||
        !Number.isSafeInteger(input.validUntil) ||
        !Number.isSafeInteger(input.decidedAt) ||
        now >= attempt.expiresAt ||
        now >= input.validUntil ||
        input.validUntil > attempt.expiresAt ||
        input.decidedAt >= input.validUntil
      )
        return false;
      if (input.decision === 'deny') {
        await store.finishAttempt(input.organizationId, attempt.id, 'denied');
        return false;
      }
      const result = reminder.fireIfDue(attempt.scheduleVersion, now);
      if (result.fact === null) return false;
      await store.save(result.reminder);
      await store.recordDue(result.fact);
      await store.finishAttempt(input.organizationId, attempt.id, 'permitted');
      const beforeCommit = this.now();
      if (
        !Number.isSafeInteger(beforeCommit) ||
        beforeCommit >= attempt.expiresAt ||
        beforeCommit >= input.validUntil
      )
        throw new ReminderAuthorizationExpired();
      return true;
    });
  }
  // #endregion
}
