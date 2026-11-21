import type { QuotaRecipients } from '../../../../ports/outbound/organization/alerts/quota-recipients.port.js';
import type { SendQuotaInboxAlertInput } from './send-quota-inbox-alert.input.js';

/** Creates a neutral Inbox receipt after a live quota authority check. */
export class SendQuotaInboxAlert {
  // #region Constructor
  /** Binds current Organization authority and the Inbox receipt operation. */
  public constructor(
    private readonly recipients: Pick<QuotaRecipients, 'isEligible'>,
    private readonly record: (input: SendQuotaInboxAlertInput) => Promise<boolean>,
  ) {}
  // #endregion

  // #region Methods
  /** Checks current membership on every attempt before Inbox evaluates its channel and writes. */
  public async execute(input: SendQuotaInboxAlertInput, signal: AbortSignal): Promise<void> {
    signal.throwIfAborted();
    if (!(await this.recipients.isEligible(input.organizationId, input.recipientId, signal))) {
      return;
    }
    signal.throwIfAborted();
    await this.record(input);
  }
  // #endregion
}
