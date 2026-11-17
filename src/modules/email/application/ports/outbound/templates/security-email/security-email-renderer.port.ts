import type { RenderedEmail } from '../../../../models/code-email/rendered-email.model.js';
import type { SecurityEmailMessage } from '../../../../models/security-email/security-email-message.model.js';

/**
 * Interface SecurityEmailRenderer
 *
 * @description
 * Renders the security e-mails from the templates compiled at build time. Rendering is pure and
 * synchronous: a missing value fails it instead of leaving a placeholder in the e-mail.
 */
export interface SecurityEmailRenderer {
  // #region Methods
  /**
   * Method renderSecurityEmail
   *
   * @description
   * Renders a security e-mail in French, the only language of the mockup, whatever the language of
   * the event, with its dates in the time zone of the message.
   *
   * @param {SecurityEmailMessage} message - What the e-mail says.
   * @returns {RenderedEmail} The subject and the two parts.
   */
  renderSecurityEmail(message: SecurityEmailMessage): RenderedEmail;
  // #endregion
}
