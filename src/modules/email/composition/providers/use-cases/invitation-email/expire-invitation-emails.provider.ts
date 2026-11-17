import type { FactoryProvider } from '@nestjs/common';
import type { InvitationEmailDeliveries } from '../../../../application/ports/outbound/persistence/invitation-email/invitation-email-deliveries.port.js';
import type { InvitationEmailSweepUnitOfWork } from '../../../../application/ports/outbound/persistence/invitation-email/invitation-email-sweep-unit-of-work.port.js';
import type { Clock } from '../../../../application/ports/outbound/time/code-email/clock.port.js';
import { ExpireInvitationEmails } from '../../../../application/use-cases/commands/invitation-email/expire-invitation-emails/expire-invitation-emails.use-case.js';
import { CLOCK } from '../../../../composition/tokens/code-email/clock.token.js';
import { INVITATION_EMAIL_DELIVERIES } from '../../../../composition/tokens/invitation-email/invitation-email-deliveries.token.js';
import { INVITATION_EMAIL_SWEEP_UNIT_OF_WORK } from '../../../../composition/tokens/invitation-email/invitation-email-sweep-unit-of-work.token.js';

/**
 * Constant expireInvitationEmailsProvider
 *
 * @description
 * Constructs the use case that settles the expired invitation e-mails.
 *
 * @type {FactoryProvider<ExpireInvitationEmails>}
 */
export const expireInvitationEmailsProvider: FactoryProvider<ExpireInvitationEmails> = {
  provide: ExpireInvitationEmails,
  inject: [INVITATION_EMAIL_SWEEP_UNIT_OF_WORK, INVITATION_EMAIL_DELIVERIES, CLOCK],
  useFactory: (
    unitOfWork: InvitationEmailSweepUnitOfWork,
    deliveries: InvitationEmailDeliveries,
    clock: Clock,
  ): ExpireInvitationEmails => new ExpireInvitationEmails(unitOfWork, deliveries, clock),
};
