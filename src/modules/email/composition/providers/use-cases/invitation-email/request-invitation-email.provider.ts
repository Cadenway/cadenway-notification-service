import type { FactoryProvider } from '@nestjs/common';
import type { InvitationEmailQueue } from '../../../../application/ports/outbound/jobs/invitation-email/invitation-email-queue.port.js';
import type { InvitationEmailDeliveries } from '../../../../application/ports/outbound/persistence/invitation-email/invitation-email-deliveries.port.js';
import type { InvitationEmailUnitOfWork } from '../../../../application/ports/outbound/persistence/invitation-email/invitation-email-unit-of-work.port.js';
import type { Clock } from '../../../../application/ports/outbound/time/code-email/clock.port.js';
import { RequestInvitationEmail } from '../../../../application/use-cases/commands/invitation-email/request-invitation-email/request-invitation-email.use-case.js';
import { CLOCK } from '../../../../composition/tokens/code-email/clock.token.js';
import { INVITATION_EMAIL_DELIVERIES } from '../../../../composition/tokens/invitation-email/invitation-email-deliveries.token.js';
import { INVITATION_EMAIL_QUEUE } from '../../../../composition/tokens/invitation-email/invitation-email-queue.token.js';
import { INVITATION_EMAIL_UNIT_OF_WORK } from '../../../../composition/tokens/invitation-email/invitation-email-unit-of-work.token.js';

/**
 * Constant requestInvitationEmailProvider
 *
 * @description
 * Constructs the use case that records and queues an invitation e-mail.
 *
 * @type {FactoryProvider<RequestInvitationEmail>}
 */
export const requestInvitationEmailProvider: FactoryProvider<RequestInvitationEmail> = {
  provide: RequestInvitationEmail,
  inject: [
    INVITATION_EMAIL_UNIT_OF_WORK,
    INVITATION_EMAIL_DELIVERIES,
    INVITATION_EMAIL_QUEUE,
    CLOCK,
  ],
  useFactory: (
    unitOfWork: InvitationEmailUnitOfWork,
    deliveries: InvitationEmailDeliveries,
    queue: InvitationEmailQueue,
    clock: Clock,
  ): RequestInvitationEmail => new RequestInvitationEmail(unitOfWork, deliveries, queue, clock),
};
