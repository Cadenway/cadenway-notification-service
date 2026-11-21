import { createHash } from 'node:crypto';

import type { FactoryProvider } from '@nestjs/common';

import { IsInAppNotificationEnabled } from '../../../../../notification-preferences/public/preferences/is-in-app-notification-enabled.js';
import { RecordAutomationNotification } from '../../../../application/use-cases/commands/inbox/record-automation-notification/record-automation-notification.use-case.js';
import { DrizzleInboxRecordsUnitOfWork } from '../../../../infrastructure/persistence/drizzle/transactions/inbox/drizzle-inbox-records.unit-of-work.js';

/** Derives a stable UUIDv8 from the command identity in its own source namespace. */
function occurrenceId(organizationId: string, ruleId: string, key: string): string {
  const hash = createHash('sha256')
    .update(JSON.stringify(['inbox-automation-notification-v1', organizationId, ruleId, key]))
    .digest('hex');
  const variant = (8 + (Number.parseInt(hash.slice(16, 17), 16) % 4)).toString(16);
  return `${hash.slice(0, 8)}-${hash.slice(8, 12)}-8${hash.slice(13, 16)}-${variant}${hash.slice(17, 20)}-${hash.slice(20, 32)}`;
}

/** Joins the inbox write and current in-app status preference with the route's receipt. */
export const recordAutomationNotificationProvider: FactoryProvider<RecordAutomationNotification> = {
  provide: RecordAutomationNotification,
  inject: [DrizzleInboxRecordsUnitOfWork, IsInAppNotificationEnabled],
  useFactory: (work: DrizzleInboxRecordsUnitOfWork, preferences: IsInAppNotificationEnabled) =>
    new RecordAutomationNotification(
      work,
      (userId) => preferences.execute({ userId, category: 'statusChange' }),
      occurrenceId,
      Date.now,
    ),
};
