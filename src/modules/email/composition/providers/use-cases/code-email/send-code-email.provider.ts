import type { FactoryProvider } from '@nestjs/common';
import { SendCodeEmail } from '../../../../application/use-cases/commands/code-email/send-code-email/send-code-email.use-case.js';
import { CODE_EMAIL_UNIT_OF_WORK } from '../../../../composition/tokens/code-email/code-email-unit-of-work.token.js';
import { CODE_EMAIL_DELIVERIES } from '../../../../composition/tokens/code-email/code-email-deliveries.token.js';
import { EMAIL_RENDERER } from '../../../../composition/tokens/code-email/email-renderer.token.js';
import { EMAIL_SENDER } from '../../../../composition/tokens/code-email/email-sender.token.js';
import { CLOCK } from '../../../../composition/tokens/code-email/clock.token.js';
import type { CodeEmailUnitOfWork } from '../../../../application/ports/outbound/persistence/code-email/code-email-unit-of-work.port.js';
import type { CodeEmailDeliveries } from '../../../../application/ports/outbound/persistence/code-email/code-email-deliveries.port.js';
import type { EmailRenderer } from '../../../../application/ports/outbound/templates/code-email/email-renderer.port.js';
import type { EmailSender } from '../../../../application/ports/outbound/smtp/code-email/email-sender.port.js';
import type { Clock } from '../../../../application/ports/outbound/time/code-email/clock.port.js';

/**
 * Constant sendCodeEmailProvider
 *
 * @description
 * Constructs the code email delivery use case.
 *
 * @type {FactoryProvider<SendCodeEmail>}
 */
export const sendCodeEmailProvider: FactoryProvider<SendCodeEmail> = {
  provide: SendCodeEmail,
  inject: [CODE_EMAIL_UNIT_OF_WORK, CODE_EMAIL_DELIVERIES, EMAIL_RENDERER, EMAIL_SENDER, CLOCK],
  useFactory: (
    unitOfWork: CodeEmailUnitOfWork,
    deliveries: CodeEmailDeliveries,
    renderer: EmailRenderer,
    sender: EmailSender,
    clock: Clock,
  ): SendCodeEmail => new SendCodeEmail(unitOfWork, deliveries, renderer, sender, clock),
};
