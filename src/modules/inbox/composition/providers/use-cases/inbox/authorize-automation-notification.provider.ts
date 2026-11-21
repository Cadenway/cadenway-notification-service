import { CONFIG, InternalTokenSigner } from '@cadenway/nest-common';
import type { FactoryProvider } from '@nestjs/common';

import type { AppConfig } from '../../../../../../config/app-config.js';
import { AuthorizeAutomationNotification } from '../../../../application/use-cases/queries/inbox/authorize-automation-notification/authorize-automation-notification.use-case.js';
import { createTaskAutomationNotificationAuthority } from '../../../../infrastructure/adapters/task-service/automation-notification-authority.adapter.js';

/** Signs Task authorization probes only when the Task origin and Notification signer are set. */
export const authorizeAutomationNotificationProvider: FactoryProvider<AuthorizeAutomationNotification> =
  {
    provide: AuthorizeAutomationNotification,
    inject: [CONFIG],
    useFactory: async ({ TASK_SERVICE_URL, INTERNAL_TOKEN_PRIVATE_JWK }: AppConfig) =>
      new AuthorizeAutomationNotification(
        createTaskAutomationNotificationAuthority({
          baseUrl: TASK_SERVICE_URL,
          signer:
            TASK_SERVICE_URL === undefined || INTERNAL_TOKEN_PRIVATE_JWK === undefined
              ? undefined
              : await InternalTokenSigner.create({
                  issuer: 'notification-service',
                  privateJwk: INTERNAL_TOKEN_PRIVATE_JWK,
                }),
        }),
      ),
  };
