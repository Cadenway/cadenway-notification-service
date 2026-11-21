import type { FactoryProvider } from '@nestjs/common';

import { IsInAppNotificationEnabled } from '../../../../../notification-preferences/public/preferences/is-in-app-notification-enabled.js';
import { RecordBillingNotice } from '../../../../application/use-cases/commands/inbox/record-billing-notice/record-billing-notice.use-case.js';
import { DrizzleInboxRecordsUnitOfWork } from '../../../../infrastructure/persistence/drizzle/transactions/inbox/drizzle-inbox-records.unit-of-work.js';

/** Binds billing receipts to the same transaction and channel reader as the Inbox. */
export const recordBillingNoticeProvider: FactoryProvider<RecordBillingNotice> = {
  provide: RecordBillingNotice,
  inject: [DrizzleInboxRecordsUnitOfWork, IsInAppNotificationEnabled],
  useFactory: (work: DrizzleInboxRecordsUnitOfWork, preferences: IsInAppNotificationEnabled) =>
    new RecordBillingNotice(
      work,
      (userId) => preferences.execute({ userId, category: 'billing' }),
      Date.now,
    ),
};
