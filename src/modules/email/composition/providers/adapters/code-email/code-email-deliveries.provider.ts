import type { ClassProvider } from '@nestjs/common';
import { CODE_EMAIL_DELIVERIES } from '../../../../composition/tokens/code-email/code-email-deliveries.token.js';
import { DrizzleCodeEmailDeliveryRepository } from '../../../../infrastructure/persistence/drizzle/repositories/code-email/drizzle-code-email-delivery.repository.js';

/**
 * Constant codeEmailDeliveriesProvider
 *
 * @description
 * Binds the code email delivery repository.
 *
 * @type {ClassProvider}
 */
export const codeEmailDeliveriesProvider: ClassProvider = {
  provide: CODE_EMAIL_DELIVERIES,
  useClass: DrizzleCodeEmailDeliveryRepository,
};
