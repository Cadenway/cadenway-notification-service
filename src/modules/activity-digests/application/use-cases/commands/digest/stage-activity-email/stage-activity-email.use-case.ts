import type { ActivityEmailCandidate } from '../../../../models/digest/activity-email-candidate.model.js';
import type { ActivityEmailUnitOfWork } from '../../../../ports/outbound/transactions/digest/activity-email-unit-of-work.port.js';
import type { StageActivityEmailInput } from './stage-activity-email.input.js';
import type { StageActivityEmailOutput } from './stage-activity-email.output.js';

/** Persists candidates independently of in-app notification delivery. */
export class StageActivityEmail {
  // #region Constructor
  /** Binds the transaction that also deduplicates a redelivered source event. */
  public constructor(
    private readonly work: ActivityEmailUnitOfWork,
    private readonly clock: () => number = Date.now,
  ) {}
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
    const { organizationId } = input.source;
    return this.work.runTenant(organizationId, async (store) => {
      // Concurrent source facts can share recipients. Acquire preference locks in UUID order.
      const eligible: ActivityEmailCandidate[] = [];
      const ordered = [...recipients.values()].sort((left, right) =>
        left.recipientId.localeCompare(right.recipientId),
      );
      const preferencesByAccount = await store.lockIntakePreferences(
        organizationId,
        ordered.map(({ recipientId }) => recipientId),
      );
      for (const candidate of ordered) {
        const preferences = preferencesByAccount.get(candidate.recipientId);
        if (preferences === undefined) throw new Error('A recipient preference was not loaded.');
        if (preferences.cadence !== 'never' && preferences.enabled[candidate.kind]) {
          eligible.push(candidate);
        }
      }
      if (eligible.length === 0) return 0;
      const inserted = await store.insertCandidates(organizationId, eligible);
      const notBeforeMs = this.clock();
      for (const recipientId of inserted) await store.enqueuePlan(recipientId, notBeforeMs);
      return inserted.length;
    });
  }
  // #endregion
}
