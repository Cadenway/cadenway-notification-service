import type { ExistingProvider } from '@nestjs/common';
import { EMAIL_RENDERER } from '../../../../composition/tokens/code-email/email-renderer.token.js';
import { INVITATION_EMAIL_RENDERER } from '../../../../composition/tokens/invitation-email/invitation-email-renderer.token.js';

/**
 * Constant invitationEmailRendererProvider
 *
 * @description
 * Binds the invitation renderer to the `HandlebarsEmailRenderer` of the code e-mails, which renders
 * every template and loads them once at start-up.
 *
 * @type {ExistingProvider}
 */
export const invitationEmailRendererProvider: ExistingProvider = {
  provide: INVITATION_EMAIL_RENDERER,
  useExisting: EMAIL_RENDERER,
};
