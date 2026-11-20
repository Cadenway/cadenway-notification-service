import type { TenantTransactionRunner, TransactionScope } from '@cadenway/nest-common/database';

import type { InboxAuthorizationAttempt } from '../../../../../application/models/inbox/inbox-authorization-attempt.model.js';
import type { InboxAuthorizationRetry } from '../../../../../application/models/inbox/inbox-authorization-retry.model.js';
import type { InboxDeliveryStore } from '../../../../../application/ports/outbound/transactions/inbox/inbox-delivery-store.port.js';
import type { InboxDeliveryUnitOfWork } from '../../../../../application/ports/outbound/transactions/inbox/inbox-delivery-unit-of-work.port.js';
import { DrizzleInboxDelivery } from '../../repositories/inbox/drizzle-inbox-delivery.repository.js';
import { DrizzleInboxRecords } from '../../repositories/inbox/drizzle-inbox-records.repository.js';

type CreatedWriter = ConstructorParameters<typeof DrizzleInboxRecords>[1];

/** Shares one tenant transaction for source deduplication, authorization and inbox outbox facts. */
export class DrizzleInboxDeliveryUnitOfWork implements InboxDeliveryUnitOfWork {
  // #region Constructor
  /** Binds the transaction runner and the transaction-aware event and job writers. */
  public constructor(
    private readonly runner: TenantTransactionRunner,
    private readonly writeRequest: (
      scope: TransactionScope,
      attempt: InboxAuthorizationAttempt,
    ) => Promise<void>,
    private readonly writeCreated: (
      scope: TransactionScope,
      ...args: Parameters<CreatedWriter>
    ) => Promise<void>,
    private readonly scheduleRetry: (
      scope: TransactionScope,
      retry: InboxAuthorizationRetry,
    ) => Promise<void>,
  ) {}
  // #endregion

  // #region Methods
  /** Joins the messaging deduplication transaction or opens a tenant transaction. */
  public run<T>(
    organizationId: string,
    execute: (store: InboxDeliveryStore) => Promise<T>,
  ): Promise<T> {
    return this.runner.run((scope) => {
      if (scope.organizationId?.toLowerCase() !== organizationId.toLowerCase()) {
        throw new Error('Inbox authorization tenant scope does not match the active transaction.');
      }
      const records = new DrizzleInboxRecords(scope, (...args) =>
        this.writeCreated(scope, ...args),
      );
      return execute(
        new DrizzleInboxDelivery(
          scope,
          records,
          (attempt) => this.writeRequest(scope, attempt),
          (retry) => this.scheduleRetry(scope, retry),
        ),
      );
    });
  }
  // #endregion
}
