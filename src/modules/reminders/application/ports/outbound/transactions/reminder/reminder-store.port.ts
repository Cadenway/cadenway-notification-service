import type { Reminder } from '../../../../../domain/aggregates/reminder/reminder.aggregate.js';

/** A tenant-scoped transaction over reminder records and durable jobs. */
export interface ReminderStore {
  // #region Methods
  /** Allocates a reminder identifier in the tenant transaction. */
  allocateId(): Promise<string>;

  /** Locks the task's unique personal slot before lookup or insertion. */
  lockTaskSlot(organizationId: string, userId: string, taskId: string): Promise<void>;

  /** Loads an owned reminder with a write lock where requested. */
  findById(
    organizationId: string,
    userId: string,
    id: string,
    lock: boolean,
  ): Promise<Reminder | null>;

  /** Loads the sole pending reminder after locking its task slot. */
  findPending(organizationId: string, userId: string, taskId: string): Promise<Reminder | null>;

  /** Stores the complete aggregate in this transaction. */
  save(reminder: Reminder): Promise<void>;

  /** Removes the locked aggregate in this transaction. */
  remove(reminder: Reminder): Promise<void>;

  /** Enqueues one idempotent job for the schedule version in this transaction. */
  schedule(reminder: Reminder): Promise<void>;
  // #endregion
}
