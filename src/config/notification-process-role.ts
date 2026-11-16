import { z } from 'zod';

/** The process compositions supported by the Notification image. */
export type NotificationProcessRole = 'combined' | 'api' | 'worker';

/** Defaults to the original service composition during deployment and rollback. */
export const notificationProcessRoleSchema: z.ZodType<{
  NOTIFICATION_PROCESS_ROLE: NotificationProcessRole;
}> = z.object({
  NOTIFICATION_PROCESS_ROLE: z.enum(['combined', 'api', 'worker']).default('combined'),
});
