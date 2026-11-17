import type { ExistingProvider } from '@nestjs/common';
import { EMAIL_RENDERER } from '../../../../composition/tokens/code-email/email-renderer.token.js';
import { SECURITY_EMAIL_RENDERER } from '../../../../composition/tokens/security-email/security-email-renderer.token.js';

/**
 * Constant securityEmailRendererProvider
 *
 * @description
 * Binds the security e-mail renderer to the `HandlebarsEmailRenderer` of the code e-mails, which
 * renders every template and loads them once at start-up.
 *
 * @type {ExistingProvider}
 */
export const securityEmailRendererProvider: ExistingProvider = {
  provide: SECURITY_EMAIL_RENDERER,
  useExisting: EMAIL_RENDERER,
};
