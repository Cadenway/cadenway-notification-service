import type { FactoryProvider } from '@nestjs/common';
import type { SecurityEmailDeliveries } from '../../../../application/ports/outbound/persistence/security-email/security-email-deliveries.port.js';
import type { SecurityEmailUnitOfWork } from '../../../../application/ports/outbound/persistence/security-email/security-email-unit-of-work.port.js';
import type { EmailSender } from '../../../../application/ports/outbound/smtp/code-email/email-sender.port.js';
import type { SecurityEmailRenderer } from '../../../../application/ports/outbound/templates/security-email/security-email-renderer.port.js';
import type { Clock } from '../../../../application/ports/outbound/time/code-email/clock.port.js';
import { SendSecurityEmail } from '../../../../application/use-cases/commands/security-email/send-security-email/send-security-email.use-case.js';
import { CLOCK } from '../../../../composition/tokens/code-email/clock.token.js';
import { EMAIL_SENDER } from '../../../../composition/tokens/code-email/email-sender.token.js';
import { SECURITY_EMAIL_DELIVERIES } from '../../../../composition/tokens/security-email/security-email-deliveries.token.js';
import { SECURITY_EMAIL_RENDERER } from '../../../../composition/tokens/security-email/security-email-renderer.token.js';
import { SECURITY_EMAIL_UNIT_OF_WORK } from '../../../../composition/tokens/security-email/security-email-unit-of-work.token.js';

/**
 * Constant sendSecurityEmailProvider
 *
 * @description
 * Constructs the security e-mail delivery use case.
 *
 * @type {FactoryProvider<SendSecurityEmail>}
 */
export const sendSecurityEmailProvider: FactoryProvider<SendSecurityEmail> = {
  provide: SendSecurityEmail,
  inject: [
    SECURITY_EMAIL_UNIT_OF_WORK,
    SECURITY_EMAIL_DELIVERIES,
    SECURITY_EMAIL_RENDERER,
    EMAIL_SENDER,
    CLOCK,
  ],
  useFactory: (
    unitOfWork: SecurityEmailUnitOfWork,
    deliveries: SecurityEmailDeliveries,
    renderer: SecurityEmailRenderer,
    sender: EmailSender,
    clock: Clock,
  ): SendSecurityEmail => new SendSecurityEmail(unitOfWork, deliveries, renderer, sender, clock),
};
