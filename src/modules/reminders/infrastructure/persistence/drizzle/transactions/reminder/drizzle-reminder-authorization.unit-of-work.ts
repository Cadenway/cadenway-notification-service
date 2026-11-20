import type { TenantTransactionRunner, TransactionScope } from '@cadenway/nest-common/database';

import type { ReminderAuthorizationAttempt } from '../../../../../application/models/reminder/reminder-authorization-attempt.model.js';
import type { ReminderAuthorizationRetry } from '../../../../../application/models/reminder/reminder-authorization-retry.model.js';
import type { ReminderAuthorizationStore } from '../../../../../application/ports/outbound/transactions/reminder/reminder-authorization-store.port.js';
import type { ReminderAuthorizationUnitOfWork } from '../../../../../application/ports/outbound/transactions/reminder/reminder-authorization-unit-of-work.port.js';
import type { ReminderDue } from '../../../../../domain/events/reminder/reminder-due.event.js';
import { DrizzleReminderAuthorization } from '../../repositories/reminder/drizzle-reminder-authorization.repository.js';

/** Starts the tenant transaction that owns the reminder and both outbox writes. */
export class DrizzleReminderAuthorizationUnitOfWork implements ReminderAuthorizationUnitOfWork {
  // #region Constructor
  /** Binds the tenant runner and transaction-aware fact writers. */
  public constructor(
    private readonly runner: TenantTransactionRunner,
    private readonly writeRequest: (
      scope: TransactionScope,
      attempt: ReminderAuthorizationAttempt,
    ) => Promise<void>,
    private readonly writeDue: (scope: TransactionScope, fact: ReminderDue) => Promise<void>,
    private readonly scheduleRetry: (
      scope: TransactionScope,
      retry: ReminderAuthorizationRetry,
    ) => Promise<void>,
  ) {}
  // #endregion

  // #region Methods
  /** Runs the authorization transition under the verified organization. */
  public run<T>(
    organizationId: string,
    execute: (store: ReminderAuthorizationStore) => Promise<T>,
  ): Promise<T> {
    return this.runner.run((scope) => {
      const tenant = organizationId.toLowerCase();
      if (scope.organizationId?.toLowerCase() !== tenant)
        throw new Error('Reminder tenant scope mismatch.');
      return execute(
        new DrizzleReminderAuthorization(
          scope,
          tenant,
          (attempt) => this.writeRequest(scope, attempt),
          (fact) => this.writeDue(scope, fact),
          (retry) => this.scheduleRetry(scope, retry),
        ),
      );
    });
  }
  // #endregion
}
