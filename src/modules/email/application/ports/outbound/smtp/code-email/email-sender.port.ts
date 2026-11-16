import type { OutgoingEmail } from '../../../../models/code-email/outgoing-email.model.js';

/**
 * Interface EmailSender
 *
 * @description
 * The SMTP server of the configuration. Sending is at least once: a second attempt after a lost
 * answer may deliver the same e-mail twice, with the same `Message-ID`.
 */
export interface EmailSender {
  // #region Methods
  /**
   * Method send
   *
   * @description
   * Hands one e-mail to the SMTP server.
   *
   * @param {OutgoingEmail} email - The e-mail.
   * @returns {Promise<void>} Settles once the server accepted it.
   * @throws {Error} When the server is unreachable or refuses it; the message names neither the
   * recipient nor the content.
   */
  send(email: OutgoingEmail): Promise<void>;
  // #endregion
}
