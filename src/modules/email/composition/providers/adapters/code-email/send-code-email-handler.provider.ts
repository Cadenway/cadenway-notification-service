import { JobWorkerRegistry } from '@cadenway/nest-jobs/runtime';
import type { FactoryProvider } from '@nestjs/common';
import { SendCodeEmailHandler } from '../../../../presentation/jobs/handlers/code-email/send-code-email.handler.js';
import { SendCodeEmail } from '../../../../application/use-cases/commands/code-email/send-code-email/send-code-email.use-case.js';
import {
  SEND_CODE_EMAIL_QUEUE,
  SEND_CODE_EMAIL_MAX_ATTEMPTS,
} from '../../../../../../config/job-queues.js';

/**
 * Constant sendCodeEmailHandlerProvider
 *
 * @description
 * Registers the code email worker with its declared queue and retry limit.
 *
 * @type {FactoryProvider<SendCodeEmailHandler>}
 */
export const sendCodeEmailHandlerProvider: FactoryProvider<SendCodeEmailHandler> = {
  provide: SendCodeEmailHandler,
  inject: [JobWorkerRegistry, SendCodeEmail],
  useFactory: (jobs: JobWorkerRegistry, useCase: SendCodeEmail): SendCodeEmailHandler =>
    new SendCodeEmailHandler(jobs, useCase, SEND_CODE_EMAIL_QUEUE, SEND_CODE_EMAIL_MAX_ATTEMPTS),
};
