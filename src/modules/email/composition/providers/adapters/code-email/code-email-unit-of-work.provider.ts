import type { ClassProvider } from '@nestjs/common';
import { CODE_EMAIL_UNIT_OF_WORK } from '../../../../composition/tokens/code-email/code-email-unit-of-work.token.js';
import { SystemCodeEmailUnitOfWork } from '../../../../infrastructure/persistence/drizzle/transactions/code-email/system-code-email.unit-of-work.js';

/**
 * Constant codeEmailUnitOfWorkProvider
 *
 * @description
 * Binds the transaction runner used by code email.
 *
 * @type {ClassProvider}
 */
export const codeEmailUnitOfWorkProvider: ClassProvider = {
  provide: CODE_EMAIL_UNIT_OF_WORK,
  useClass: SystemCodeEmailUnitOfWork,
};
