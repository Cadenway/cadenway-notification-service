import type { ClassProvider } from '@nestjs/common';
import { SECURITY_EMAIL_UNIT_OF_WORK } from '../../../../composition/tokens/security-email/security-email-unit-of-work.token.js';
import { SystemSecurityEmailUnitOfWork } from '../../../../infrastructure/persistence/drizzle/transactions/security-email/system-security-email.unit-of-work.js';

/**
 * Constant securityEmailUnitOfWorkProvider
 *
 * @description
 * Binds the system transaction runner used by the security e-mails.
 *
 * @type {ClassProvider}
 */
export const securityEmailUnitOfWorkProvider: ClassProvider = {
  provide: SECURITY_EMAIL_UNIT_OF_WORK,
  useClass: SystemSecurityEmailUnitOfWork,
};
