import type { EmailSender } from '../../../../ports/outbound/smtp/code-email/email-sender.port.js';
import type { QuotaAlertRenderer } from '../../../../ports/outbound/templates/quota-alert/quota-alert-renderer.port.js';
import type { SendQuotaAlertEmailInput } from './send-quota-alert-email.input.js';

/** Submits an authorized quota email through the Email transport. */
export class SendQuotaAlertEmail {
  // #region Constructor
  /** Binds the quota renderer and existing SMTP sender. */
  public constructor(
    private readonly renderer: QuotaAlertRenderer,
    private readonly sender: EmailSender,
  ) {}
  // #endregion

  // #region Methods
  /** Keeps the job identifier as the SMTP Message-ID across retries. */
  public async execute(input: SendQuotaAlertEmailInput): Promise<void> {
    const rendered = this.renderer.renderQuotaAlert(
      input.metric,
      input.thresholdPercent,
      input.used,
      input.limit,
    );
    await this.sender.send({
      ...rendered,
      id: `quota-${input.occurrenceId}`,
      to: { address: input.address, name: '' },
      unsubscribe: false,
    });
  }
  // #endregion
}
