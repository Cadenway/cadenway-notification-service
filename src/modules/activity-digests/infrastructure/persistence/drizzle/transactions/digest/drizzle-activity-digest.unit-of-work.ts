import type {
  SystemTransactionRunner,
  TenantTransactionRunner,
  TransactionScope,
} from '@cadenway/nest-common/database';
import { sql } from 'drizzle-orm';

import type { ActivityEmailPreferences } from '../../../../../application/models/digest/activity-email-preferences.model.js';
import type { ActivityDeliveryUnitOfWork } from '../../../../../application/ports/outbound/transactions/digest/activity-delivery-unit-of-work.port.js';
import type { ActivityEmailUnitOfWork } from '../../../../../application/ports/outbound/transactions/digest/activity-email-unit-of-work.port.js';
import { DrizzleActivityDelivery } from '../../repositories/digest/drizzle-activity-delivery.repository.js';
import { DrizzleActivityEmail } from '../../repositories/digest/drizzle-activity-email.repository.js';

/** Transaction-bound preferences, jobs and external Task facts provided by composition. */
export interface ActivityDigestPersistenceBindings {
  // #region Methods
  /** Reads the account's email choices under the preferences capability's own lock. */
  readPreferences(scope: TransactionScope, userId: string): Promise<ActivityEmailPreferences>;

  /** Schedules a bounded account planning pass with no private delivery fields. */
  enqueuePlan(
    scope: TransactionScope,
    job: { readonly userId: string; readonly notBeforeMs: number },
  ): Promise<void>;

  /** Enqueues the stable occurrence and generation for its reserved due instant. */
  enqueueDelivery(
    scope: TransactionScope,
    job: {
      readonly userId: string;
      readonly occurrenceId: string;
      readonly generation: number;
      readonly runAt: number;
    },
  ): Promise<void>;

  /** Appends the published Task authorization request in the attempt transaction. */
  writeAuthorization(
    scope: TransactionScope,
    request: {
      readonly attemptId: string;
      readonly organizationId: string;
      readonly recipientId: string;
      readonly taskKey: string;
      readonly expiresAt: number;
    },
  ): Promise<void>;
  // #endregion
}

/** Binds a store to either a verified tenant or an explicitly selected system account. */
export class ActivityDigestScope {
  // #region Constructor
  /** Receives the actual transaction and the optional account bound by a system worker. */
  public constructor(
    public readonly transaction: TransactionScope,
    private readonly accountId?: string,
  ) {}
  // #endregion

  // #region Methods
  /** Checks the global queue's account boundary before using system access. */
  public requireAccount(userId: string): string {
    const id = userId.toLowerCase();
    if (this.transaction.kind !== 'system' || this.accountId !== id) {
      throw new Error('Activity email account scope does not match the active transaction.');
    }
    return id;
  }

  /** Checks the signed tenant scope before reading or writing tenant-owned data. */
  public requireTenant(organizationId: string): string {
    const id = organizationId.toLowerCase();
    if (
      this.transaction.kind !== 'tenant' ||
      this.transaction.organizationId?.toLowerCase() !== id
    ) {
      throw new Error('Activity email tenant scope does not match the active transaction.');
    }
    return id;
  }

  /** Serializes scheduling, authorization rotation and leases for the same account. */
  public async lockAccount(userId: string): Promise<void> {
    await this.transaction.db.execute(
      sql`select pg_advisory_xact_lock(hashtextextended('activity_email:' || ${userId}::uuid::text, 0))`,
    );
  }
  // #endregion
}

/** Combines the shared account lock and verified tenant runner for both activity stores. */
export class DrizzleActivityDigestUnitOfWork {
  // #region Properties
  /** Staging and planning transactions. */
  public readonly email: ActivityEmailUnitOfWork;

  /** Authorization and send-lease transactions. */
  public readonly delivery: ActivityDeliveryUnitOfWork;
  // #endregion

  // #region Constructor
  /** Binds infrastructure writes to the same transaction as each application transition. */
  public constructor(
    private readonly tenant: TenantTransactionRunner,
    private readonly system: SystemTransactionRunner,
    bindings: ActivityDigestPersistenceBindings,
  ) {
    this.email = {
      runAccount: (userId, work) =>
        this.runAccount(userId, (scope) => work(new DrizzleActivityEmail(scope, bindings))),
      runTenant: (organizationId, work) =>
        this.runTenant(organizationId, (scope) => work(new DrizzleActivityEmail(scope, bindings))),
    };
    this.delivery = {
      runAccount: (userId, work) =>
        this.runAccount(userId, (scope) => work(new DrizzleActivityDelivery(scope, bindings))),
      runTenant: (organizationId, work) =>
        this.runTenant(organizationId, (scope) =>
          work(new DrizzleActivityDelivery(scope, bindings)),
        ),
    };
  }
  // #endregion

  // #region Methods
  /** Uses read committed so account locks serialize snapshots with prior committed workers. */
  private runAccount<T>(
    userId: string,
    work: (scope: ActivityDigestScope) => Promise<T>,
  ): Promise<T> {
    const accountId = userId.toLowerCase();
    return this.system.run(
      async (transaction) => {
        const scope = new ActivityDigestScope(transaction, accountId);
        scope.requireAccount(accountId);
        await scope.lockAccount(accountId);
        return work(scope);
      },
      { isolationLevel: 'read committed' },
    );
  }

  /** Reuses the messaging deduplication transaction and rejects a mismatched verified tenant. */
  private runTenant<T>(
    organizationId: string,
    work: (scope: ActivityDigestScope) => Promise<T>,
  ): Promise<T> {
    return this.tenant.run((transaction) => {
      const scope = new ActivityDigestScope(transaction);
      scope.requireTenant(organizationId);
      return work(scope);
    });
  }
  // #endregion
}
