import type { ClassProvider } from '@nestjs/common';
import { INVITATION_EMAIL_DELIVERIES } from '../../../../composition/tokens/invitation-email/invitation-email-deliveries.token.js';
import { DrizzleInvitationEmailDeliveryRepository } from '../../../../infrastructure/persistence/drizzle/repositories/invitation-email/drizzle-invitation-email-delivery.repository.js';

/**
 * Constant invitationEmailDeliveriesProvider
 *
 * @description
 * Binds the invitation e-mail delivery repository.
 *
 * @type {ClassProvider}
 */
export const invitationEmailDeliveriesProvider: ClassProvider = {
  provide: INVITATION_EMAIL_DELIVERIES,
  useClass: DrizzleInvitationEmailDeliveryRepository,
};
