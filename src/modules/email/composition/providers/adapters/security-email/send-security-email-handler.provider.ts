import { JobsService } from '@cadenway/nest-jobs';
import type { FactoryProvider } from '@nestjs/common';
import {
  SEND_SECURITY_EMAIL_MAX_ATTEMPTS,
  SEND_SECURITY_EMAIL_QUEUE,
} from '../../../../../../config/job-queues.js';
import { SendSecurityEmail } from '../../../../application/use-cases/commands/security-email/send-security-email/send-security-email.use-case.js';
import { SendSecurityEmailHandler } from '../../../../presentation/jobs/handlers/security-email/send-security-email.handler.js';

/**
 * Constant sendSecurityEmailHandlerProvider
 *
 * @description
 * Registers the security e-mail worker with its declared queue and retry limit.
 *
 * @type {FactoryProvider<SendSecurityEmailHandler>}
 */
export const sendSecurityEmailHandlerProvider: FactoryProvider<SendSecurityEmailHandler> = {
  provide: SendSecurityEmailHandler,
  inject: [JobsService, SendSecurityEmail],
  useFactory: (jobs: JobsService, useCase: SendSecurityEmail): SendSecurityEmailHandler =>
    new SendSecurityEmailHandler(
      jobs,
      useCase,
      SEND_SECURITY_EMAIL_QUEUE,
      SEND_SECURITY_EMAIL_MAX_ATTEMPTS,
    ),
};
