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
   * Property unsubscribe
   *
   * @description
   * Whether the e-mail carries `List-Unsubscribe`, to Compte › Notifications, with its one-click
   * form `List-Unsubscribe-Post` (RFC 8058). A security e-mail, always sent and impossible to turn
   * off ("Sécurité · toujours envoyé" of the Emails artboard), carries neither
   * (cw-email-templates).
   *
   * @type {boolean}
   * @readonly
   */
  readonly unsubscribe: boolean;
  // #endregion
}
