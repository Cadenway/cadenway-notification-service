import type { FactoryProvider } from '@nestjs/common';
import type { EmailSender } from '../../../../application/ports/outbound/smtp/code-email/email-sender.port.js';
import type { ActivityNoticeRenderer } from '../../../../application/ports/outbound/templates/activity-notice/activity-notice-renderer.port.js';
import type { Clock } from '../../../../application/ports/outbound/time/code-email/clock.port.js';
import { SendActivityNotice } from '../../../../application/use-cases/commands/activity-notice/send-activity-notice/send-activity-notice.use-case.js';
import { CLOCK } from '../../../tokens/code-email/clock.token.js';
import { EMAIL_RENDERER } from '../../../tokens/code-email/email-renderer.token.js';
import { EMAIL_SENDER } from '../../../tokens/code-email/email-sender.token.js';

/** Exposes the activity notice operation backed by the existing Email runtime. */
export const sendActivityNoticeProvider: FactoryProvider<SendActivityNotice> = {
  provide: SendActivityNotice,
  inject: [EMAIL_RENDERER, EMAIL_SENDER, CLOCK],
  useFactory: (renderer: ActivityNoticeRenderer, sender: EmailSender, clock: Clock) =>
    new SendActivityNotice(renderer, sender, clock),
};
