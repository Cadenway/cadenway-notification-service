import { Module } from '@nestjs/common';

import { EmailModule } from '../email/email.module.js';
import { NotificationPreferencesModule } from '../notification-preferences/notification-preferences.module.js';
import { quotaAlertRuntimeProvider } from './composition/providers/adapters/alerts/quota-alert-runtime.provider.js';

/** Composes organization quota email processing. */
@Module({
  imports: [EmailModule, NotificationPreferencesModule],
  providers: [quotaAlertRuntimeProvider],
})
export class QuotaAlertsModule {}
