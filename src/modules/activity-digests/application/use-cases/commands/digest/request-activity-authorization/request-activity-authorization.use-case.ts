import type { ActivityDeliveryUnitOfWork } from '../../../../ports/outbound/transactions/digest/activity-delivery-unit-of-work.port.js';
import type { RequestActivityAuthorizationInput } from './request-activity-authorization.input.js';
import type { RequestActivityAuthorizationOutput } from './request-activity-authorization.output.js';

/** Requests a current Task decision for each item before an activity delivery. */
export class RequestActivityAuthorization {
  // #region Constructor
  /** Binds the occurrence transaction and monotone caller-supplied deadline check. */
  public constructor(
    private readonly work: ActivityDeliveryUnitOfWork,
    private readonly clock: () => number,
  ) {}
  // #endregion

  // #region Methods
  /** Requests and their outbox records commit with the occurrence state. */
  public execute(
    input: RequestActivityAuthorizationInput,
  ): Promise<RequestActivityAuthorizationOutput> {
    if (!Number.isSafeInteger(input.expiresAt) || input.expiresAt <= this.clock()) {
      throw new RangeError('Activity authorization expiry must be in the future.');
    }
    return this.work.runTenant(input.organizationId, async (store) => {
      await store.requestAuthorization(
        input.organizationId,
        input.userId,
        input.occurrenceId,
        input.generation,
        input.expiresAt,
      );
      if (this.clock() >= input.expiresAt)
        throw new Error('Activity authorization expired while staging.');
      return true as const;
    });
  }
  // #endregion
}
