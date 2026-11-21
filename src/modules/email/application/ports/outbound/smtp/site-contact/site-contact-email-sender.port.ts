import type { SendSiteContactEmailInput } from '../../../../use-cases/commands/site-contact/send-site-contact-email/send-site-contact-email.input.js';

/** Submits a plain-text support message with a stable identity for SMTP retries. */
export interface SiteContactEmailSender {
  // #region Methods
  /** Sends to the configured support address with the visitor address used only for Reply-To. */
  sendSiteContact(input: SendSiteContactEmailInput): Promise<void>;
  // #endregion
}
