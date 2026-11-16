import type { RenderedEmail } from './rendered-email.model.js';

/**
 * Interface OutgoingEmail
 *
 * @description
 * An e-mail handed to the SMTP server: a rendered e-mail, its recipient, and what decides its
 * headers.
 */
export interface OutgoingEmail extends RenderedEmail {
  // #region Properties
  /**
   * Property id
   *
   * @description
   * Id of the delivery. The sender derives the `Message-ID` from it, so a second attempt of the
   * same delivery sends the same `Message-ID`.
   *
   * @type {string}
   * @readonly
   */
  readonly id: string;

  /**
   * Property to
   *
   * @description
   * Recipient: its address, and its cleaned name, empty to write to the address alone. Personal
   * data, never logged.
   *
   * @type {{ readonly address: string; readonly name: string }}
   * @readonly
   */
  readonly to: { readonly address: string; readonly name: string };

  /**
   * Property oneClickUnsubscribe
   *
   * @description
   * Whether the e-mail offers the one-click unsubscription of `List-Unsubscribe-Post`. Every
   * e-mail carries `List-Unsubscribe`; a security e-mail, always sent, never offers the one-click
   * form (cw-email-templates).
   *
   * @type {boolean}
   * @readonly
   */
  readonly oneClickUnsubscribe: boolean;
  // #endregion
}
