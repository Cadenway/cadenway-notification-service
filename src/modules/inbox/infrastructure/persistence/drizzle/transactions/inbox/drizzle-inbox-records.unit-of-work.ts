import type { TenantTransactionRunner, TransactionScope } from '@cadenway/nest-common/database';

import type { NotificationCreated } from '../../../../../domain/events/inbox/notification-created.event.js';
import { DrizzleInboxRecords } from '../../repositories/inbox/drizzle-inbox-records.repository.js';

type Subject =
  | { readonly kind: 'task-key'; readonly taskKey: string }
  | { readonly kind: 'task-id'; readonly taskId: string }
  | { readonly kind: 'space'; readonly spaceId: string }
  | { readonly kind: 'list'; readonly listId: string }
  | null;
type FactWriter = (
  scope: TransactionScope,
  fact: NotificationCreated,
  subject: Subject,
) => Promise<void>;

/** Opens the tenant transaction for inbox effects and their outbox facts. */
export class DrizzleInboxRecordsUnitOfWork {
  // #region Constructor
  /** Binds the shared runner and its transaction-aware outbox writer. */
  public constructor(
    private readonly runner: TenantTransactionRunner,
    private readonly writeFact: FactWriter,
  ) {}
  // #endregion

  // #region Methods
  /** Runs a bounded operation under the verified tenant context. */
  public run<T>(
    organizationId: string,
    work: (records: DrizzleInboxRecords) => Promise<T>,
  ): Promise<T> {
    return this.runner.run((scope) => work(this.records(scope, organizationId)));
  }

  /** Runs a read without allowing any writes to the owner's inbox. */
  public read<T>(
    organizationId: string,
    work: (records: DrizzleInboxRecords) => Promise<T>,
  ): Promise<T> {
    return this.runner.run((scope) => work(this.records(scope, organizationId)), {
      readOnly: true,
    });
  }

  /** Binds the verified tenant and outbox writer to this unit of work. */
  private records(scope: TransactionScope, organizationId: string): DrizzleInboxRecords {
    if (scope.organizationId?.toLowerCase() !== organizationId.toLowerCase()) {
      throw new Error('Inbox tenant scope does not match the active transaction.');
    }
    return new DrizzleInboxRecords(scope, (fact, subject) => this.writeFact(scope, fact, subject));
  }
  // #endregion
}
