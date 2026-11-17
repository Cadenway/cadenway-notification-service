import type { FactoryProvider } from '@nestjs/common';
import type { SecurityEmailDeliveries } from '../../../../application/ports/outbound/persistence/security-email/security-email-deliveries.port.js';
import type { SecurityEmailUnitOfWork } from '../../../../application/ports/outbound/persistence/security-email/security-email-unit-of-work.port.js';
import type { Clock } from '../../../../application/ports/outbound/time/code-email/clock.port.js';
import { ExpireSecurityEmails } from '../../../../application/use-cases/commands/security-email/expire-security-emails/expire-security-emails.use-case.js';
import { CLOCK } from '../../../../composition/tokens/code-email/clock.token.js';
import { SECURITY_EMAIL_DELIVERIES } from '../../../../composition/tokens/security-email/security-email-deliveries.token.js';
import { SECURITY_EMAIL_UNIT_OF_WORK } from '../../../../composition/tokens/security-email/security-email-unit-of-work.token.js';

/**
 * Constant expireSecurityEmailsProvider
 *
 * @description
 * Constructs the use case that settles the security e-mails whose window closed.
 *
 * @type {FactoryProvider<ExpireSecurityEmails>}
 */
export const expireSecurityEmailsProvider: FactoryProvider<ExpireSecurityEmails> = {
  provide: ExpireSecurityEmails,
  inject: [SECURITY_EMAIL_UNIT_OF_WORK, SECURITY_EMAIL_DELIVERIES, CLOCK],
  useFactory: (
    unitOfWork: SecurityEmailUnitOfWork,
    deliveries: SecurityEmailDeliveries,
    clock: Clock,
  ): ExpireSecurityEmails => new ExpireSecurityEmails(unitOfWork, deliveries, clock),
};
