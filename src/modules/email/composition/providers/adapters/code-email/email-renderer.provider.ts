import type { FactoryProvider } from '@nestjs/common';
import { CONFIG } from '@cadenway/nest-common';
import type { EmailConfig } from '../../../../../../config/app-config.js';
import { EMAIL_RENDERER } from '../../../../composition/tokens/code-email/email-renderer.token.js';
import type { EmailRenderer } from '../../../../application/ports/outbound/templates/code-email/email-renderer.port.js';
import { HandlebarsEmailRenderer } from '../../../../infrastructure/adapters/templates/handlebars-email-renderer.adapter.js';

/**
 * Constant emailRendererProvider
 *
 * @description
 * Loads the compiled templates at module startup.
 *
 * @type {FactoryProvider<EmailRenderer>}
 */
export const emailRendererProvider: FactoryProvider<EmailRenderer> = {
  provide: EMAIL_RENDERER,
  inject: [CONFIG],
  useFactory: (config: EmailConfig): Promise<EmailRenderer> =>
    HandlebarsEmailRenderer.load(config.WEB_APP_URL),
};
