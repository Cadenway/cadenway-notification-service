import { JobsService } from '@cadenway/nest-jobs';
import type { FactoryProvider } from '@nestjs/common';
import {
  SEND_INVITATION_EMAIL_MAX_ATTEMPTS,
  SEND_INVITATION_EMAIL_QUEUE,
} from '../../../../../../config/job-queues.js';
import { SendInvitationEmail } from '../../../../application/use-cases/commands/invitation-email/send-invitation-email/send-invitation-email.use-case.js';
import { SendInvitationEmailHandler } from '../../../../presentation/jobs/handlers/invitation-email/send-invitation-email.handler.js';

/**
 * Constant sendInvitationEmailHandlerProvider
 *
 * @description
 * Registers the invitation e-mail worker with its declared queue and retry limit.
 *
 * @type {FactoryProvider<SendInvitationEmailHandler>}
 */
export const sendInvitationEmailHandlerProvider: FactoryProvider<SendInvitationEmailHandler> = {
  provide: SendInvitationEmailHandler,
  inject: [JobsService, SendInvitationEmail],
  useFactory: (jobs: JobsService, useCase: SendInvitationEmail): SendInvitationEmailHandler =>
    new SendInvitationEmailHandler(
      jobs,
      useCase,
      SEND_INVITATION_EMAIL_QUEUE,
      SEND_INVITATION_EMAIL_MAX_ATTEMPTS,
    ),
};
