import type { ActivityEmailRecipient } from '../../../../models/digest/activity-email-recipient.model.js';
import type { ActivityEmailSender } from '../../../../ports/outbound/email/digest/activity-email-sender.port.js';
import type { ActivityRecipientReader } from '../../../../ports/outbound/identity/digest/activity-recipient-reader.port.js';
import type { ActivityDeliveryStore } from '../../../../ports/outbound/transactions/digest/activity-delivery-store.port.js';
import type { ActivityDeliveryUnitOfWork } from '../../../../ports/outbound/transactions/digest/activity-delivery-unit-of-work.port.js';
import type { SendActivityEmailInput } from './send-activity-email.input.js';
import type { SendActivityEmailOutput } from './send-activity-email.output.js';

interface ClaimedDelivery {
  // #region Properties
  /** Authorization and lease deadline for a sanitized dispatch. */
  readonly leaseId: string;
  readonly validUntil: number;
  readonly count: number;
  // #endregion
}

/** Compares Identity fields that authorize the address and determine the schedule and language. */
function sameRecipient(a: ActivityEmailRecipient, b: ActivityEmailRecipient): boolean {
  return (
    a.userId.toLowerCase() === b.userId.toLowerCase() &&
    a.version === b.version &&
    a.email === b.email &&
    a.language === b.language &&
    a.timeZone === b.timeZone
  );
}

/** Sends a leased occurrence only while each included Task permit remains valid. */
export class SendActivityEmail {
  // #region Constructor
  /** Binds the current Identity reader, durable state and existing email capability. */
  public constructor(
    private readonly recipients: ActivityRecipientReader,
    private readonly work: ActivityDeliveryUnitOfWork,
    private readonly email: ActivityEmailSender,
    private readonly clock: () => number,
  ) {}
  // #endregion

  // #region Methods
  /** Temporary failures release the lease and propagate to bounded job retries. */
  public async execute(
    input: SendActivityEmailInput,
    signal?: AbortSignal,
  ): Promise<SendActivityEmailOutput> {
    signal?.throwIfAborted();
    const { userId, occurrenceId, generation } = input;
    const recipient = await this.recipients.findCurrent(userId);
    signal?.throwIfAborted();
    if (recipient === null) {
      await this.work.runAccount(userId, (store) =>
        store.skipRecipient(userId, occurrenceId, generation),
      );
      return 'empty';
    }
    if (recipient.userId.toLowerCase() !== userId.toLowerCase()) {
      throw new Error('Activity recipient does not match the requested account.');
    }
    const delivery = await this.work.runAccount(userId, (store) =>
      this.claim(store, input, recipient.version),
    );
    if (delivery === null) return 'pending';
    const { leaseId, count, validUntil } = delivery;
    try {
      signal?.throwIfAborted();
      if (count > 0) {
        if (this.clock() >= validUntil) return 'pending';
        const current = await this.recipients.findCurrent(userId);
        signal?.throwIfAborted();
        if (current === null) {
          return (await this.complete(input, leaseId)) ? 'empty' : 'pending';
        }
        if (!sameRecipient(recipient, current)) {
          await this.work.runAccount(userId, (store) => this.replan(store, input, leaseId));
          return 'pending';
        }
        if (this.clock() >= validUntil) return 'pending';
        await this.email.send({ occurrenceId, recipient: current, count, validUntil });
      }
      const finished = await this.complete(input, leaseId);
      if (!finished) throw new Error('Activity delivery lease was lost.');
      return count === 0 ? 'empty' : 'sent';
    } finally {
      await this.work.runAccount(userId, (store) =>
        store.release(userId, occurrenceId, generation, leaseId),
      );
    }
  }

  /** Captures current choices and positive permits under the same account transaction. */
  private async claim(
    store: ActivityDeliveryStore,
    input: SendActivityEmailInput,
    profileVersion: number,
  ): Promise<ClaimedDelivery | null> {
    const { userId, occurrenceId, generation } = input;
    const occurrence = await store.lockDueOccurrence(userId, occurrenceId, generation);
    if (occurrence === null) return null;
    const recipientId = userId.toLowerCase();
    if (
      occurrence.recipientId.toLowerCase() !== recipientId ||
      occurrence.occurrenceId !== occurrenceId ||
      occurrence.generation !== generation
    ) {
      throw new Error('Activity delivery does not match the requested occurrence.');
    }
    const preferences = await store.readPreferences(userId);
    if (
      preferences.cadence !== occurrence.cadence ||
      profileVersion !== occurrence.profileVersion
    ) {
      await this.replan(store, input);
      return null;
    }

    const decisions = await store.listDeliveryDecisions(userId, occurrenceId, generation);
    const now = this.clock();
    let permitDeadline = Number.POSITIVE_INFINITY;
    let count = 0;
    for (const { recipientId: owner, kind, outcome, validUntil } of decisions) {
      if (owner.toLowerCase() !== recipientId) {
        throw new Error('Activity decision does not match the requested account.');
      }
      if (!preferences.enabled[kind]) continue;
      if (outcome === 'denied' && validUntil !== null) continue;
      if (
        outcome !== 'permitted' ||
        validUntil === null ||
        !Number.isSafeInteger(validUntil) ||
        validUntil <= now
      ) {
        return null;
      }
      permitDeadline = Math.min(permitDeadline, validUntil);
      count += 1;
    }
    const lease = await store.claim(userId, occurrenceId, generation);
    if (!Number.isSafeInteger(lease.validUntil)) {
      throw new Error('Activity delivery lease has an invalid deadline.');
    }
    return { leaseId: lease.id, count, validUntil: Math.min(lease.validUntil, permitDeadline) };
  }

  /** Transition and durable planning commit together, after the exact lease check. */
  private async replan(
    store: ActivityDeliveryStore,
    { userId, occurrenceId, generation }: SendActivityEmailInput,
    leaseId?: string,
  ): Promise<void> {
    if (await store.supersede(userId, occurrenceId, generation, leaseId)) {
      await store.enqueuePlan(userId, this.clock());
    }
  }

  /** Records the result only while the same generation and lease still own it. */
  private complete(
    { userId, occurrenceId, generation }: SendActivityEmailInput,
    leaseId: string,
  ): Promise<boolean> {
    return this.work.runAccount(userId, (store) =>
      store.finish(userId, occurrenceId, generation, leaseId),
    );
  }
  // #endregion
}
