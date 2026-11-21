/** A support message accepted by the site-forms module for delivery. */
export interface SendSiteContactEmailInput {
  // #region Properties
  /** Stable submission ID used to derive the SMTP Message-ID. */
  readonly submissionId: string;

  /** Server-configured mailbox for the support team. */
  readonly supportAddress: string;

  /** Validated visitor mailbox, used only as Reply-To. */
  readonly replyTo: string;

  /** Fixed category used to select a server-controlled subject. */
  readonly subject: 'login' | 'mfa' | 'org' | 'data' | 'other';

  /** Validated plain-text message supplied by the visitor. */
  readonly message: string;
  // #endregion
}
