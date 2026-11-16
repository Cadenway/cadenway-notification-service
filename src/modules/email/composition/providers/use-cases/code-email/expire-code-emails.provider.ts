import type { FactoryProvider } from '@nestjs/common';
import { ExpireCodeEmails } from '../../../../application/use-cases/commands/code-email/expire-code-emails/expire-code-emails.use-case.js';
import { CODE_EMAIL_UNIT_OF_WORK } from '../../../../composition/tokens/code-email/code-email-unit-of-work.token.js';
import { CODE_EMAIL_DELIVERIES } from '../../../../composition/tokens/code-email/code-email-deliveries.token.js';
import { CLOCK } from '../../../../composition/tokens/code-email/clock.token.js';
import type { CodeEmailUnitOfWork } from '../../../../application/ports/outbound/persistence/code-email/code-email-unit-of-work.port.js';
import type { CodeEmailDeliveries } from '../../../../application/ports/outbound/persistence/code-email/code-email-deliveries.port.js';
import type { Clock } from '../../../../application/ports/outbound/time/code-email/clock.port.js';

/**
 * Constant expireCodeEmailsProvider
 *
 * @description
 * Constructs the use case that settles expired code emails.
 *
 * @type {FactoryProvider<ExpireCodeEmails>}
 */
export const expireCodeEmailsProvider: FactoryProvider<ExpireCodeEmails> = {
  provide: ExpireCodeEmails,
  inject: [CODE_EMAIL_UNIT_OF_WORK, CODE_EMAIL_DELIVERIES, CLOCK],
  useFactory: (
    unitOfWork: CodeEmailUnitOfWork,
    deliveries: CodeEmailDeliveries,
    clock: Clock,
  ): ExpireCodeEmails => new ExpireCodeEmails(unitOfWork, deliveries, clock),
};
