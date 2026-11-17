import type { ClassProvider } from '@nestjs/common';
import { SECURITY_EMAIL_QUEUE } from '../../../../composition/tokens/security-email/security-email-queue.token.js';
import { JobsSecurityEmailQueue } from '../../../../infrastructure/jobs/pg-boss/security-email/jobs-security-email-queue.adapter.js';

/**
 * Constant securityEmailQueueProvider
 *
 * @description
 * Binds the durable queue of the security e-mails.
 *
 * @type {ClassProvider}
 */
export const securityEmailQueueProvider: ClassProvider = {
  provide: SECURITY_EMAIL_QUEUE,
  useClass: JobsSecurityEmailQueue,
};
