import { planActivityEmail } from '../../../../../domain/policies/digest/activity-email-schedule.policy.js';
import type { ActivityRecipientReader } from '../../../../ports/outbound/identity/digest/activity-recipient-reader.port.js';
import type { ActivityEmailUnitOfWork } from '../../../../ports/outbound/transactions/digest/activity-email-unit-of-work.port.js';
import type { PlanActivityEmailInput } from './plan-activity-email.input.js';
import type { PlanActivityEmailOutput } from './plan-activity-email.output.js';

const pageSize = 100;

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
      return store.schedule(input.userId, preferences, occurrence, pageSize);
    });
  }
  // #endregion
}
