import type { ClassProvider } from '@nestjs/common';
import { CODE_EMAIL_QUEUE } from '../../../../composition/tokens/code-email/code-email-queue.token.js';
import { JobsCodeEmailQueue } from '../../../../infrastructure/jobs/pg-boss/code-email/jobs-code-email-queue.adapter.js';

/**
 * Constant codeEmailQueueProvider
 *
 * @description
 * Binds the durable email job queue.
 *
 * @type {ClassProvider}
 */
export const codeEmailQueueProvider: ClassProvider = {
  provide: CODE_EMAIL_QUEUE,
  useClass: JobsCodeEmailQueue,
};
