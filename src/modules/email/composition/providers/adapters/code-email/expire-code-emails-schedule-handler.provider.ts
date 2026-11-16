import { JobScheduler } from '@cadenway/nest-jobs/runtime';
import type { FactoryProvider } from '@nestjs/common';

import {
  EXPIRE_CODE_EMAILS_CRON,
  EXPIRE_CODE_EMAILS_QUEUE,
} from '../../../../../../config/job-queues.js';
import { ExpireCodeEmailsScheduleHandler } from '../../../../presentation/jobs/handlers/code-email/expire-code-emails-schedule.handler.js';

/** Binds the scheduler to the expiry declaration used by the migrator and the worker. */
export const expireCodeEmailsScheduleHandlerProvider: FactoryProvider<ExpireCodeEmailsScheduleHandler> =
  {
    provide: ExpireCodeEmailsScheduleHandler,
    inject: [JobScheduler],
    useFactory: (jobs: JobScheduler): ExpireCodeEmailsScheduleHandler =>
      new ExpireCodeEmailsScheduleHandler(jobs, EXPIRE_CODE_EMAILS_QUEUE, EXPIRE_CODE_EMAILS_CRON),
  };
