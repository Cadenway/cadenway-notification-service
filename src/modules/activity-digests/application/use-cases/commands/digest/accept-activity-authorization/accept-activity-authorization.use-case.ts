import type { ActivityDeliveryUnitOfWork } from '../../../../ports/outbound/transactions/digest/activity-delivery-unit-of-work.port.js';
import type { AcceptActivityAuthorizationInput } from './accept-activity-authorization.input.js';
import type { AcceptActivityAuthorizationOutput } from './accept-activity-authorization.output.js';

/** Accepts at most one timely Task decision for the exact pending correlation. */
export class AcceptActivityAuthorization {
  // #region Constructor
  /** Binds the same tenant transaction as event deduplication. */
  public constructor(
    private readonly work: ActivityDeliveryUnitOfWork,
    private readonly clock: () => number,
  ) {}
  // #endregion

  // #region Methods
  /** Expired and superseded correlations cannot authorize delivery. */
  public execute(
    input: AcceptActivityAuthorizationInput,
  ): Promise<AcceptActivityAuthorizationOutput> {
    return this.work.runTenant(input.organizationId, async (store) => {
      const attempt = await store.lockAttempt(input.organizationId, input.attemptId);
      if (
        attempt?.outcome !== 'pending' ||
        attempt.organizationId.toLowerCase() !== input.organizationId.toLowerCase()
      )
        return false;
      const now = this.clock();
      if (now >= attempt.expiresAt) {
        await store.finishAttempt(input.organizationId, attempt.id, 'expired', attempt.expiresAt);
        return false;
      }
      if (
        !Number.isSafeInteger(input.validUntil) ||
        !Number.isSafeInteger(input.decidedAt) ||
        now >= input.validUntil ||
        input.validUntil > attempt.expiresAt ||
        input.decidedAt >= input.validUntil
      )
        return false;
      await store.finishAttempt(
        input.organizationId,
        attempt.id,
        input.decision === 'permit' ? 'permitted' : 'denied',
        input.validUntil,
      );
      if (this.clock() >= input.validUntil)
        throw new Error('Activity authorization expired while recording its decision.');
      return true;
    });
  }
  // #endregion
}
