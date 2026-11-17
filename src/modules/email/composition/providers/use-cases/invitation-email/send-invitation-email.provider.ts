import type { FactoryProvider } from '@nestjs/common';
import type { InvitationEmailDeliveries } from '../../../../application/ports/outbound/persistence/invitation-email/invitation-email-deliveries.port.js';
import type { InvitationEmailUnitOfWork } from '../../../../application/ports/outbound/persistence/invitation-email/invitation-email-unit-of-work.port.js';
import type { EmailSender } from '../../../../application/ports/outbound/smtp/code-email/email-sender.port.js';
import type { InvitationEmailRenderer } from '../../../../application/ports/outbound/templates/invitation-email/invitation-email-renderer.port.js';
import type { Clock } from '../../../../application/ports/outbound/time/code-email/clock.port.js';
import { SendInvitationEmail } from '../../../../application/use-cases/commands/invitation-email/send-invitation-email/send-invitation-email.use-case.js';
import { CLOCK } from '../../../../composition/tokens/code-email/clock.token.js';
import { EMAIL_SENDER } from '../../../../composition/tokens/code-email/email-sender.token.js';
import { INVITATION_EMAIL_DELIVERIES } from '../../../../composition/tokens/invitation-email/invitation-email-deliveries.token.js';
import { INVITATION_EMAIL_RENDERER } from '../../../../composition/tokens/invitation-email/invitation-email-renderer.token.js';
import { INVITATION_EMAIL_UNIT_OF_WORK } from '../../../../composition/tokens/invitation-email/invitation-email-unit-of-work.token.js';

/**
 * Constant sendInvitationEmailProvider
 *
 * @description
 * Constructs the invitation e-mail delivery use case, on the SMTP sender of the code e-mails.
 *
 * @type {FactoryProvider<SendInvitationEmail>}
 */
export const sendInvitationEmailProvider: FactoryProvider<SendInvitationEmail> = {
  provide: SendInvitationEmail,
  inject: [
    INVITATION_EMAIL_UNIT_OF_WORK,
    INVITATION_EMAIL_DELIVERIES,
    INVITATION_EMAIL_RENDERER,
    EMAIL_SENDER,
    CLOCK,
  ],
  useFactory: (
    unitOfWork: InvitationEmailUnitOfWork,
    deliveries: InvitationEmailDeliveries,
    renderer: InvitationEmailRenderer,
    sender: EmailSender,
    clock: Clock,
  ): SendInvitationEmail =>
    new SendInvitationEmail(unitOfWork, deliveries, renderer, sender, clock),
};
