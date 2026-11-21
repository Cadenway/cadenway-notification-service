import {
  eventSchemas,
  QUOTA_THRESHOLD_REACHED_V1,
} from '@cadenway/contracts/events/billing-service';
import type { EventConsumers } from '@cadenway/nest-messaging';
import type { OnApplicationBootstrap } from '@nestjs/common';

import type { RequestQuotaAlert } from '../../../../application/use-cases/commands/alerts/request-quota-alert/request-quota-alert.use-case.js';

/** Persists a quota threshold alert after the installed Billing fact is validated. */
export class QuotaThresholdReachedHandler implements OnApplicationBootstrap {
  // #region Constructor
  /** Binds the tenant-aware kit consumer to the initial quota command. */
  public constructor(
    private readonly consumers: Pick<EventConsumers, 'subscribe'>,
    private readonly request: Pick<RequestQuotaAlert, 'execute'>,
  ) {}
  // #endregion

  // #region Methods
  /** Subscribes on first start and relies on the durable position afterwards. */
  public async onApplicationBootstrap(): Promise<void> {
    await this.consumers.subscribe({
      handler: 'notify-quota-threshold',
      schemas: eventSchemas,
      event: QUOTA_THRESHOLD_REACHED_V1,
      deliverPolicy: 'new',
      handle: async (event, { signal }) => {
        signal.throwIfAborted();
        if (event.actor.type !== 'system' || event.actor.id !== 'billing-service') return;
        await this.request.execute({
          organizationId: event.organizationId,
          alert: {
            eventId: event.id,
            metric: event.metric,
            thresholdPercent: event.thresholdPercent,
            used: event.used,
            limit: event.limit,
          },
        });
        signal.throwIfAborted();
      },
    });
  }
  // #endregion
}
