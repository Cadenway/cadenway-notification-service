import { SystemTransactionRunner, TenantTransactionRunner } from '@cadenway/nest-common/database';
import { Module } from '@nestjs/common';

import { UpdateNotificationPreferences } from './application/use-cases/commands/preferences/update-notification-preferences/update-notification-preferences.use-case.js';
import { GetNotificationPreferences } from './application/use-cases/queries/preferences/get-notification-preferences/get-notification-preferences.use-case.js';
import { IsInAppNotificationEnabled } from './application/use-cases/queries/preferences/is-in-app-notification-enabled/is-in-app-notification-enabled.use-case.js';
import { ReadActivityPreferences } from './application/use-cases/queries/preferences/read-activity-preferences/read-activity-preferences.use-case.js';
import { readActivityPreferencesProvider } from './composition/providers/use-cases/preferences/read-activity-preferences.provider.js';
import { DrizzleInAppNotificationEnabled } from './infrastructure/persistence/drizzle/repositories/preferences/drizzle-in-app-notification-enabled.repository.js';
import { SystemPreferencesUnitOfWork } from './infrastructure/persistence/drizzle/transactions/preferences/system-preferences.unit-of-work.js';
import { NotificationPreferencesController } from './presentation/http/controllers/preferences/notification-preferences.controller.js';

/** Composition boundary for account notification preferences. */
@Module({
  controllers: [NotificationPreferencesController],
  providers: [
    readActivityPreferencesProvider,
    {
      provide: IsInAppNotificationEnabled,
      inject: [TenantTransactionRunner],
      useFactory: (runner: TenantTransactionRunner): IsInAppNotificationEnabled => {
        const reader = new DrizzleInAppNotificationEnabled(runner);
        return new IsInAppNotificationEnabled(({ userId, category }) =>
          reader.execute(userId, category),
        );
      },
    },
    {
      provide: SystemPreferencesUnitOfWork,
      inject: [SystemTransactionRunner],
      useFactory: (runner: SystemTransactionRunner): SystemPreferencesUnitOfWork =>
        new SystemPreferencesUnitOfWork(runner),
    },
    {
      provide: GetNotificationPreferences,
      inject: [SystemPreferencesUnitOfWork],
      useFactory: (work: SystemPreferencesUnitOfWork): GetNotificationPreferences =>
        new GetNotificationPreferences(work),
    },
    {
      provide: UpdateNotificationPreferences,
      inject: [SystemPreferencesUnitOfWork],
      useFactory: (work: SystemPreferencesUnitOfWork): UpdateNotificationPreferences =>
        new UpdateNotificationPreferences(work),
    },
  ],
  exports: [IsInAppNotificationEnabled, ReadActivityPreferences],
})
export class NotificationPreferencesModule {}
