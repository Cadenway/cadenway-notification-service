import type { ClassProvider } from '@nestjs/common';
import { INVITATION_EMAIL_SWEEP_UNIT_OF_WORK } from '../../../../composition/tokens/invitation-email/invitation-email-sweep-unit-of-work.token.js';
import { SystemInvitationEmailSweepUnitOfWork } from '../../../../infrastructure/persistence/drizzle/transactions/invitation-email/system-invitation-email-sweep.unit-of-work.js';

/**
 * Constant invitationEmailSweepUnitOfWorkProvider
 *
 * @description
 * Binds the system transaction of the sweep of the invitation e-mails.
 *
 * @type {ClassProvider}
 */
export const invitationEmailSweepUnitOfWorkProvider: ClassProvider = {
  provide: INVITATION_EMAIL_SWEEP_UNIT_OF_WORK,
  useClass: SystemInvitationEmailSweepUnitOfWork,
};
