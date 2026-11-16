import type { FactoryProvider } from '@nestjs/common';
import { RequestCodeEmail } from '../../../../application/use-cases/commands/code-email/request-code-email/request-code-email.use-case.js';
import { CODE_EMAIL_UNIT_OF_WORK } from '../../../../composition/tokens/code-email/code-email-unit-of-work.token.js';
import { CODE_EMAIL_DELIVERIES } from '../../../../composition/tokens/code-email/code-email-deliveries.token.js';
import { CODE_EMAIL_QUEUE } from '../../../../composition/tokens/code-email/code-email-queue.token.js';
import { CLOCK } from '../../../../composition/tokens/code-email/clock.token.js';
import type { CodeEmailUnitOfWork } from '../../../../application/ports/outbound/persistence/code-email/code-email-unit-of-work.port.js';
import type { CodeEmailDeliveries } from '../../../../application/ports/outbound/persistence/code-email/code-email-deliveries.port.js';
import type { CodeEmailQueue } from '../../../../application/ports/outbound/jobs/code-email/code-email-queue.port.js';
import type { Clock } from '../../../../application/ports/outbound/time/code-email/clock.port.js';

/**
 * Constant requestCodeEmailProvider
 *
 * @description
 * Constructs the use case that records and queues a code email.
 *
 * @type {FactoryProvider<RequestCodeEmail>}
 */
export const requestCodeEmailProvider: FactoryProvider<RequestCodeEmail> = {
  provide: RequestCodeEmail,
  inject: [CODE_EMAIL_UNIT_OF_WORK, CODE_EMAIL_DELIVERIES, CODE_EMAIL_QUEUE, CLOCK],
  useFactory: (
    unitOfWork: CodeEmailUnitOfWork,
    deliveries: CodeEmailDeliveries,
    queue: CodeEmailQueue,
    clock: Clock,
  ): RequestCodeEmail => new RequestCodeEmail(unitOfWork, deliveries, queue, clock),
};
