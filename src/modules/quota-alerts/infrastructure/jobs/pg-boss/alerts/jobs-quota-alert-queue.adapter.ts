import type { TenantTransactionRunner, TransactionScope } from '@cadenway/nest-common/database';
import type { JobsService } from '@cadenway/nest-jobs';

import { QUOTA_ALERT_QUEUE } from '../../../../../../config/job-queues.js';
import type { QuotaAlert } from '../../../../application/models/alerts/quota-alert.model.js';
import type { QuotaAlertQueue } from '../../../../application/ports/outbound/jobs/alerts/quota-alert-queue.port.js';

/** Inserts one recipient job per event account while the retained operation exists. */
export class JobsQuotaAlertQueue implements QuotaAlertQueue {
  // #region Constructor
  /** Uses the kit to join the event receipt or commit a planned recipient page. */
  public constructor(
    private readonly tenant: TenantTransactionRunner,
    private readonly jobs: Pick<JobsService, 'enqueue'>,
  ) {}
  // #endregion

  // #region Methods
  /** Stages initial discovery in the same transaction as the event receipt. */
  public request(organizationId: string, alert: QuotaAlert): Promise<void> {
    return this.tenant.run(async (scope) => {
      this.assertTenant(scope, organizationId);
      await this.enqueuePage(scope, alert, null);
    });
  }

  /** Persists the whole bounded page and the next fetch together. */
  public stagePage(
    organizationId: string,
    alert: QuotaAlert,
    userIds: readonly string[],
    nextCursor: string | null,
  ): Promise<void> {
    return this.tenant.run(async (scope) => {
      this.assertTenant(scope, organizationId);
      for (const userId of userIds) {
        await this.jobs.enqueue(
          scope,
          QUOTA_ALERT_QUEUE,
          { kind: 'deliver', alert, userId },
          { occurrenceKey: `${alert.eventId}:recipient:${userId}` },
        );
      }
      if (nextCursor !== null) await this.enqueuePage(scope, alert, nextCursor);
    });
  }

  private assertTenant(scope: TransactionScope, organizationId: string): void {
    if (scope.kind !== 'tenant' || scope.organizationId !== organizationId) {
      throw new Error('Quota alert jobs require their organization transaction.');
    }
  }

  private async enqueuePage(
    scope: TransactionScope,
    alert: QuotaAlert,
    cursor: string | null,
  ): Promise<void> {
    await this.jobs.enqueue(
      scope,
      QUOTA_ALERT_QUEUE,
      { kind: 'page', alert, cursor },
      { occurrenceKey: `${alert.eventId}:page:${cursor ?? ''}` },
    );
  }
  // #endregion
}
