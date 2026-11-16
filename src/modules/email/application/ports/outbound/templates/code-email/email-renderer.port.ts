import type { CodeEmailMessage } from '../../../../models/code-email/code-email-message.model.js';
import type { RenderedEmail } from '../../../../models/code-email/rendered-email.model.js';

/**
 * Interface EmailRenderer
 *
 * @description
 * Renders the e-mails from the templates compiled at build time. Rendering is pure and
 * synchronous: a missing value fails it instead of leaving a placeholder in the e-mail.
 */
export interface EmailRenderer {
  // #region Methods
  /**
   * Method renderCodeEmail
   *
   * @description
   * Renders a code e-mail in French, the only language of the mockup.
   *
   * @param {CodeEmailMessage} message - What the e-mail says.
   * @returns {RenderedEmail} The subject and the two parts.
   */
  renderCodeEmail(message: CodeEmailMessage): RenderedEmail;
  // #endregion
}
