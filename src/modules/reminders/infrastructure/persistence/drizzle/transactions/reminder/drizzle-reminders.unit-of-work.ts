import type { TenantTransactionRunner, TransactionScope } from '@cadenway/nest-common/database';

import type { ReminderStore } from '../../../../../application/ports/outbound/transactions/reminder/reminder-store.port.js';
import type { RemindersUnitOfWork } from '../../../../../application/ports/outbound/transactions/reminder/reminders-unit-of-work.port.js';
import type { Reminder } from '../../../../../domain/aggregates/reminder/reminder.aggregate.js';
import { DrizzleReminderRecords } from '../../repositories/reminder/drizzle-reminder-records.repository.js';

/** Runs reminder CRUD and its durable job enqueue in one tenant transaction. */
export class DrizzleRemindersUnitOfWork implements RemindersUnitOfWork {
  // #region Constructor
  /** Binds the tenant runner and a scheduler that uses the same transaction. */
  public constructor(
    private readonly runner: TenantTransactionRunner,
    private readonly schedule: (scope: TransactionScope, reminder: Reminder) => Promise<void>,
  ) {}
  // #endregion

  // #region Methods
  /** Supplies owner-scoped persistence and transaction-bound scheduling to a use case. */
  public run<T>(organizationId: string, work: (store: ReminderStore) => Promise<T>): Promise<T> {
    return this.runner.run((scope) => {
      const tenant = organizationId.toLowerCase();
      const records = new DrizzleReminderRecords(scope, tenant);
      const lockedSlots = new Set<string>();
      const requireTenant = (candidate: string): void => {
        if (candidate.toLowerCase() !== tenant) throw new Error('Reminder tenant scope mismatch.');
      };
      const slotKey = (userId: string, taskId: string): string =>
        `${userId.toLowerCase()}:${taskId.toLowerCase()}`;
      const store: ReminderStore = {
        allocateId: () => records.newId(),
        lockTaskSlot: async (candidate, userId, taskId) => {
          requireTenant(candidate);
          await records.lockTaskSlot(userId, taskId);
          lockedSlots.add(slotKey(userId, taskId));
        },
        findById: (candidate, userId, id, lock) => {
          requireTenant(candidate);
          return records.findById(userId, id, lock);
        },
        findPending: (candidate, userId, taskId) => {
          requireTenant(candidate);
          return records.findPending(userId, taskId, lockedSlots.has(slotKey(userId, taskId)));
        },
        save: (reminder) => records.save(reminder),
        remove: (reminder) => records.remove(reminder),
        schedule: (reminder) => this.schedule(scope, reminder),
        taskVisibility: () => Promise.resolve('unavailable'),
        recordDue: () => Promise.reject(new Error('Use the reminder authorization workflow.')),
      };
      return work(store);
    });
  }
  // #endregion
}
