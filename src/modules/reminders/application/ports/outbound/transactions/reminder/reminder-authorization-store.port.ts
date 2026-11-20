import type { Reminder } from '../../../../../domain/aggregates/reminder/reminder.aggregate.js';
import type { ReminderDue } from '../../../../../domain/events/reminder/reminder-due.event.js';
import type { ReminderAuthorizationAttempt } from '../../../../models/reminder/reminder-authorization-attempt.model.js';
import type { ReminderAuthorizationRetry } from '../../../../models/reminder/reminder-authorization-retry.model.js';

/** The operations participating in one tenant-scoped authorization transaction. */
export interface ReminderAuthorizationStore {
  // #region Methods
  /** Allocates a new authorization identifier in the active tenant transaction. */
  allocateAttemptId(): Promise<string>;

  /** Reads the immutable locator without taking a lock. */
  findAttempt(
    organizationId: string,
    attemptId: string,
  ): Promise<ReminderAuthorizationAttempt | null>;

  /** Locks the caller-owned reminder before locking its attempts. */
  lockReminder(
    organizationId: string,
    userId: string,
    reminderId: string,
  ): Promise<Reminder | null>;

  /** Locks the active attempt for the reminder, including a previously completed outcome. */
  lockCurrentAttempt(
    organizationId: string,
    reminderId: string,
  ): Promise<ReminderAuthorizationAttempt | null>;

  /** Stores the new pending attempt and appends its request fact in this same transaction. */
  requestAuthorization(attempt: ReminderAuthorizationAttempt): Promise<void>;

  /** Enqueues the expiration follow-up in the active transaction. */
  scheduleRetry(retry: ReminderAuthorizationRetry): Promise<void>;

  /** Persists a terminal outcome only after locking the current attempt. */
  finishAttempt(
    organizationId: string,
    attemptId: string,
    status: 'permitted' | 'denied' | 'expired',
  ): Promise<void>;

  /** Persists the reminder transition in this transaction. */
  save(reminder: Reminder): Promise<void>;

  /** Appends the due fact in the same transaction as the transition. */
  recordDue(fact: ReminderDue): Promise<void>;
  // #endregion
}
