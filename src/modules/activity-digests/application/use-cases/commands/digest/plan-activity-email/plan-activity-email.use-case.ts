import {
  activityEmailPageSize,
  planActivityEmail,
} from '../../../../../domain/policies/digest/activity-email-schedule.policy.js';
import type { ActivityEmailOccurrence } from '../../../../../domain/value-objects/digest/activity-email-occurrence.value-object.js';
import type { ActivityEmailCandidate } from '../../../../models/digest/activity-email-candidate.model.js';
import type { ActivityRecipientReader } from '../../../../ports/outbound/identity/digest/activity-recipient-reader.port.js';
import type { ActivityEmailStore } from '../../../../ports/outbound/transactions/digest/activity-email-store.port.js';
import type { ActivityEmailUnitOfWork } from '../../../../ports/outbound/transactions/digest/activity-email-unit-of-work.port.js';
import type { PlanActivityEmailInput } from './plan-activity-email.input.js';
import type { PlanActivityEmailOutput } from './plan-activity-email.output.js';

/** Plans activity sends from the current account profile and stored channel choices. */
export class PlanActivityEmail {
  // #region Constructor
  /** Identity is read outside the transaction; jobs are enqueued with their occurrence. */
  public constructor(
    private readonly recipients: ActivityRecipientReader,
    private readonly work: ActivityEmailUnitOfWork,
  ) {}
  // #endregion

  // #region Methods
  /** An unavailable Identity read rejects; a no-longer-eligible account schedules nothing. */
  public async execute(input: PlanActivityEmailInput): Promise<PlanActivityEmailOutput> {
    const recipient = await this.recipients.findCurrent(input.userId);
    if (recipient?.userId.toLowerCase() !== input.userId.toLowerCase()) return 0;
    return this.work.runAccount(input.userId, async (store) => {
      const preferences = await store.lockPreferences(input.userId);
      const occurrence = planActivityEmail(preferences.cadence, input.notBeforeMs, recipient);
      if (occurrence === null) return 0;
      const kinds = (Object.keys(preferences.enabled) as ActivityEmailCandidate['kind'][]).filter(
        (kind) => preferences.enabled[kind],
      );
      if (kinds.length === 0) return 0;
      const selected = await store.listPendingCandidateIds(
        input.userId,
        kinds,
        occurrence.cadence === 'each' ? null : occurrence.dueAtMs,
        activityEmailPageSize,
      );
      if (selected.length === 0) return 0;
      return occurrence.cadence === 'each'
        ? this.scheduleIndividuals(store, input.userId, occurrence, preferences.version, selected)
        : this.scheduleDigest(store, input.userId, occurrence, preferences.version, selected);
    });
  }

  /** Binds and enqueues the current immediate page before resuming with a new transaction. */
  private async scheduleIndividuals(
    store: ActivityEmailStore,
    userId: string,
    occurrence: Extract<ActivityEmailOccurrence, { cadence: 'each' }>,
    preferenceVersion: number,
    selected: readonly string[],
  ): Promise<number> {
    const assignments = await store.reserveIndividuals(
      userId,
      occurrence,
      preferenceVersion,
      selected.slice(0, activityEmailPageSize),
    );
    await store.assignCandidates(userId, assignments);
    for (const { reservation } of assignments) {
      await store.enqueueDelivery(userId, reservation, occurrence.dueAtMs);
    }
    if (selected.length > activityEmailPageSize) {
      await store.enqueuePlan(userId, occurrence.dueAtMs);
    }
    return assignments.length;
  }

  /** Shares one future slot across sources and leaves overflow pending until its next cycle. */
  private async scheduleDigest(
    store: ActivityEmailStore,
    userId: string,
    occurrence: Exclude<ActivityEmailOccurrence, { cadence: 'each' }>,
    preferenceVersion: number,
    selected: readonly string[],
  ): Promise<number> {
    const slot = await store.findDigestSlot(userId, occurrence);
    const newReservation = slot === null || slot.state === 'superseded';
    const reservation = newReservation
      ? await store.reserveDigest(userId, occurrence, preferenceVersion)
      : { id: slot.id, generation: slot.generation };
    let capacity = 0;
    if (newReservation) {
      capacity = activityEmailPageSize;
    } else if (
      slot.acceptsAssignments &&
      slot.profileVersion === occurrence.profileVersion &&
      slot.dueAtMs === occurrence.dueAtMs
    ) {
      capacity = activityEmailPageSize - (await store.countDigestAssignments(userId, reservation));
    }
    if (capacity > 0) {
      await store.assignCandidates(
        userId,
        selected.slice(0, capacity).map((candidateId) => ({ candidateId, reservation })),
      );
    }
    if (newReservation) await store.enqueueDelivery(userId, reservation, occurrence.dueAtMs);
    if (selected.length > capacity) {
      const cutoff = occurrence.dueAtMs + 1;
      await store.enqueuePlan(userId, cutoff, cutoff);
    }
    return newReservation ? 1 : 0;
  }
  // #endregion
}
