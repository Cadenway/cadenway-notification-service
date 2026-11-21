import type { QuotaEmailDelivery } from '../../../../ports/outbound/email/alerts/quota-email-delivery.port.js';
import type { QuotaRecipients } from '../../../../ports/outbound/organization/alerts/quota-recipients.port.js';
import type { SendQuotaAlertInput } from './send-quota-alert.input.js';

/** Revalidates the current recipient and submits a quota alert. */
export class SendQuotaAlert {
  // #region Constructor
  /** Binds the two sources of current email eligibility. */
  public constructor(
    private readonly recipients: QuotaRecipients,
    private readonly delivery: QuotaEmailDelivery,
  ) {}
  // #endregion

  // #region Methods
  /** Defers on an unavailable authority and skips disabled or revoked recipients. */
  public async execute(
    { organizationId, userId, occurrenceId, alert }: SendQuotaAlertInput,
    signal: AbortSignal,
  ): Promise<void> {
    signal.throwIfAborted();
    if (!(await this.delivery.isEnabled(userId))) return;
    signal.throwIfAborted();
    const address = await this.delivery.resolve(userId, signal);
    if (address === null) return;
    if (!(await this.recipients.isEligible(organizationId, userId, signal))) return;
    signal.throwIfAborted();
    await this.delivery.send(occurrenceId, address, alert);
  }
  // #endregion
}
