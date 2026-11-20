import type { ActivityAuthorizationCandidate } from '../../../../models/digest/activity-authorization-candidate.model.js';
import type { ActivityDeliveryUnitOfWork } from '../../../../ports/outbound/transactions/digest/activity-delivery-unit-of-work.port.js';
import type { RequestActivityAuthorizationInput } from './request-activity-authorization.input.js';
import type { RequestActivityAuthorizationOutput } from './request-activity-authorization.output.js';

/** Live correlations and final denials are reused for the current generation. */
function needsAuthorization(candidate: ActivityAuthorizationCandidate, now: number): boolean {
  switch (candidate.outcome) {
    case null:
    case 'expired':
      return true;
    case 'pending':
      return candidate.expiresAt !== null && candidate.expiresAt <= now;
    case 'permitted':
      return candidate.validUntil !== null && candidate.validUntil <= now;
    case 'denied':
      return false;
  }
}

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
    const { organizationId, userId, occurrenceId, generation, expiresAt } = input;
    if (!Number.isSafeInteger(expiresAt) || expiresAt <= this.clock()) {
      throw new RangeError('Activity authorization expiry must be in the future.');
    }
    return this.work.runTenant(
      organizationId,
      async (store): Promise<RequestActivityAuthorizationOutput> => {
        const candidates = await store.listAuthorizationCandidates(
          organizationId,
          userId,
          occurrenceId,
          generation,
        );
        const now = this.clock();
        if (now >= expiresAt) throw new Error('Activity authorization expired while staging.');
        const taskKeys = new Map(
          candidates
            .filter((candidate) => needsAuthorization(candidate, now))
            .map(({ candidateId, taskKey }) => [candidateId, taskKey]),
        );
        if (taskKeys.size === 0) return true;
        const attempts = await store.reserveAuthorizationAttempts(
          organizationId,
          userId,
          occurrenceId,
          generation,
          expiresAt,
          [...taskKeys.keys()],
        );
        for (const { attemptId, candidateId } of attempts) {
          const taskKey = taskKeys.get(candidateId);
          if (taskKey === undefined) throw new Error('Activity authorization lost its candidate.');
          await store.appendAuthorization({
            organizationId,
            attemptId,
            recipientId: userId,
            taskKey,
            expiresAt,
          });
        }
        if (this.clock() >= expiresAt)
          throw new Error('Activity authorization expired while staging.');
        return true;
      },
    );
  }
  // #endregion
}
