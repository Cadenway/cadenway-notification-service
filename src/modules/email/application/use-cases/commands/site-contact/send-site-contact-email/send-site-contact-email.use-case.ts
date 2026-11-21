import type { SiteContactEmailSender } from '../../../../ports/outbound/smtp/site-contact/site-contact-email-sender.port.js';
import type { SendSiteContactEmailInput } from './send-site-contact-email.input.js';

/** Sends a previously accepted site message to the configured support mailbox. */
export class SendSiteContactEmail {
  // #region Constructor
  /** Uses the service's SMTP sender. */
  public constructor(private readonly sender: SiteContactEmailSender) {}
  // #endregion

  // #region Methods
  /** Keeps the submission identity stable across delivery retries. */
  public async execute(input: SendSiteContactEmailInput): Promise<void> {
    await this.sender.sendSiteContact(input);
  }
  // #endregion
}
