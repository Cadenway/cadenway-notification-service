import type { FactoryProvider } from '@nestjs/common';
import type { SecurityEmailQueue } from '../../../../application/ports/outbound/jobs/security-email/security-email-queue.port.js';
import type { SecurityEmailDeliveries } from '../../../../application/ports/outbound/persistence/security-email/security-email-deliveries.port.js';
import type { SecurityEmailUnitOfWork } from '../../../../application/ports/outbound/persistence/security-email/security-email-unit-of-work.port.js';
import type { Clock } from '../../../../application/ports/outbound/time/code-email/clock.port.js';
import { RequestSecurityEmail } from '../../../../application/use-cases/commands/security-email/request-security-email/request-security-email.use-case.js';
import { CLOCK } from '../../../../composition/tokens/code-email/clock.token.js';
import { SECURITY_EMAIL_DELIVERIES } from '../../../../composition/tokens/security-email/security-email-deliveries.token.js';
import { SECURITY_EMAIL_QUEUE } from '../../../../composition/tokens/security-email/security-email-queue.token.js';
import { SECURITY_EMAIL_UNIT_OF_WORK } from '../../../../composition/tokens/security-email/security-email-unit-of-work.token.js';

/**
 * Constant requestSecurityEmailProvider
 *
 * @description
 * Constructs the use case that records and queues a security e-mail.
 *
 * @type {FactoryProvider<RequestSecurityEmail>}
 */
export const requestSecurityEmailProvider: FactoryProvider<RequestSecurityEmail> = {
  provide: RequestSecurityEmail,
  inject: [SECURITY_EMAIL_UNIT_OF_WORK, SECURITY_EMAIL_DELIVERIES, SECURITY_EMAIL_QUEUE, CLOCK],
  useFactory: (
    unitOfWork: SecurityEmailUnitOfWork,
    deliveries: SecurityEmailDeliveries,
    queue: SecurityEmailQueue,
    clock: Clock,
  ): RequestSecurityEmail => new RequestSecurityEmail(unitOfWork, deliveries, queue, clock),
};
