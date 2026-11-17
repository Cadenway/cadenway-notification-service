import type { ClassProvider } from '@nestjs/common';
import { INVITATION_EMAIL_UNIT_OF_WORK } from '../../../../composition/tokens/invitation-email/invitation-email-unit-of-work.token.js';
import { TenantInvitationEmailUnitOfWork } from '../../../../infrastructure/persistence/drizzle/transactions/invitation-email/tenant-invitation-email.unit-of-work.js';

/**
 * Constant invitationEmailUnitOfWorkProvider
 *
 * @description
 * Binds the tenant transaction of the invitation e-mails.
 *
 * @type {ClassProvider}
 */
export const invitationEmailUnitOfWorkProvider: ClassProvider = {
  provide: INVITATION_EMAIL_UNIT_OF_WORK,
  useClass: TenantInvitationEmailUnitOfWork,
};
