import type { ClassProvider } from '@nestjs/common';
import { SECURITY_EMAIL_DELIVERIES } from '../../../../composition/tokens/security-email/security-email-deliveries.token.js';
import { DrizzleSecurityEmailDeliveryRepository } from '../../../../infrastructure/persistence/drizzle/repositories/security-email/drizzle-security-email-delivery.repository.js';

/**
 * Constant securityEmailDeliveriesProvider
 *
 * @description
 * Binds the security e-mail delivery repository.
 *
 * @type {ClassProvider}
 */
export const securityEmailDeliveriesProvider: ClassProvider = {
  provide: SECURITY_EMAIL_DELIVERIES,
  useClass: DrizzleSecurityEmailDeliveryRepository,
};
