import type { FactoryProvider } from '@nestjs/common';
import { CONFIG } from '@cadenway/nest-common';
import type { AppConfig } from '../../../../../../config/app-config.js';
import { EMAIL_RENDERER } from '../../../../composition/tokens/code-email/email-renderer.token.js';
import { HandlebarsEmailRenderer } from '../../../../infrastructure/adapters/templates/handlebars-email-renderer.adapter.js';

/**
 * Constant emailRendererProvider
 *
 * @description
 * Loads the compiled templates at module startup.
 *
 * @type {FactoryProvider<HandlebarsEmailRenderer>}
 */
export const emailRendererProvider: FactoryProvider<HandlebarsEmailRenderer> = {
  provide: EMAIL_RENDERER,
  inject: [CONFIG],
  useFactory: (config: AppConfig): Promise<HandlebarsEmailRenderer> =>
    HandlebarsEmailRenderer.load(config.WEB_APP_URL),
};
