import type { InvitationEmailMessage } from '../../../../models/invitation-email/invitation-email-message.model.js';
import type { RenderedEmail } from '../../../../models/code-email/rendered-email.model.js';

/**
 * Interface InvitationEmailRenderer
 *
 * @description
 * Renders the "Invitation" e-mail from the template compiled at build time. Rendering is pure and
 * synchronous: a missing value fails it instead of leaving a placeholder in the e-mail.
 */
export interface InvitationEmailRenderer {
  // #region Methods
  /**
   * Method renderInvitationEmail
   *
   * @description
   * Renders an invitation e-mail in French, the only language of the mockup, whatever the
   * language of the event.
   *
   * @param {InvitationEmailMessage} message - What the e-mail says.
   * @returns {RenderedEmail} The subject and the two parts.
   */
  renderInvitationEmail(message: InvitationEmailMessage): RenderedEmail;
  // #endregion
}
