import type { ClassProvider } from '@nestjs/common';
import { INVITATION_EMAIL_QUEUE } from '../../../../composition/tokens/invitation-email/invitation-email-queue.token.js';
import { JobsInvitationEmailQueue } from '../../../../infrastructure/jobs/pg-boss/invitation-email/jobs-invitation-email-queue.adapter.js';

/**
 * Constant invitationEmailQueueProvider
 *
 * @description
 * Binds the durable queue of the invitation e-mails.
 *
 * @type {ClassProvider}
 */
export const invitationEmailQueueProvider: ClassProvider = {
  provide: INVITATION_EMAIL_QUEUE,
  useClass: JobsInvitationEmailQueue,
};
