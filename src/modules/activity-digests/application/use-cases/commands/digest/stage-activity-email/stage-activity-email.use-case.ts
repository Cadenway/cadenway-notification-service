import type { ActivityEmailCandidate } from '../../../../models/digest/activity-email-candidate.model.js';
import type { ActivityEmailUnitOfWork } from '../../../../ports/outbound/transactions/digest/activity-email-unit-of-work.port.js';
import type { StageActivityEmailInput } from './stage-activity-email.input.js';
import type { StageActivityEmailOutput } from './stage-activity-email.output.js';

/** Persists candidates independently of in-app notification delivery. */
export class StageActivityEmail {
  // #region Constructor
  /** Binds the transaction that also deduplicates a redelivered source event. */
  public constructor(private readonly work: ActivityEmailUnitOfWork) {}
  // #endregion

  // #region Methods
  /** Keeps the first audience for each person and excludes the original actor. */
  public execute(input: StageActivityEmailInput): Promise<StageActivityEmailOutput> {
    const actor = input.source.actorUserId?.toLowerCase();
    const recipients = new Map<string, ActivityEmailCandidate>();
    for (const audience of input.audiences) {
      for (const value of audience.recipientIds) {
        const recipientId = value.toLowerCase();
        if (recipientId !== actor && !recipients.has(recipientId)) {
          recipients.set(recipientId, { ...input.source, recipientId, kind: audience.kind });
        }
      }
    }
    if (recipients.size === 0) return Promise.resolve(0);
    return this.work.runTenant(input.source.organizationId, (store) =>
      store.stage(input.source.organizationId, [...recipients.values()]),
    );
  }
  // #endregion
}
