import type { JobQueueDeclaration } from '@cadenway/nest-jobs';

/**
 * Constant SEND_CODE_EMAIL_QUEUE
 *
 * @description
 * Queue of the e-mails that carry a single-use code (address confirmation, sign-in). One job per
 * e-mail, whose payload is the id of its row in `code_email_deliveries` and whose occurrence key
 * is that same id, so the same e-mail is never enqueued twice.
 *
 * @type {string}
 */
export const SEND_CODE_EMAIL_QUEUE: string = 'email.send-code';

/**
 * Constant SEND_CODE_EMAIL_MAX_ATTEMPTS
 *
 * @description
 * Attempts a code e-mail gets, the first one included: `retryLimit + 1` of its queue. The handler
 * marks the delivery `failed` when the last one fails.
 *
 * @type {number}
 */
export const SEND_CODE_EMAIL_MAX_ATTEMPTS: number = 5;

/**
 * Constant EXPIRE_CODE_EMAILS_QUEUE
 *
 * @description
 * Queue of the sweep that settles the code e-mails whose code expired before they could leave:
 * whatever happened to their job (deleted unstarted, last attempt failed by a crash or a timeout),
 * the delivery becomes `skipped` and its code and address are deleted. Scheduled by
 * `EXPIRE_CODE_EMAILS_CRON`; its jobs carry no payload.
 *
 * @type {string}
 */
export const EXPIRE_CODE_EMAILS_QUEUE: string = 'email.expire-codes';

/**
 * Constant EXPIRE_CODE_EMAILS_CRON
 *
 * @description
 * When the sweep runs: every 5 minutes, in UTC. A code and an address outlive the expiry of the
 * code by 5 minutes at most, plus the 40 seconds pg-boss takes to evaluate a schedule.
 *
 * @type {string}
 */
export const EXPIRE_CODE_EMAILS_CRON: string = '*/5 * * * *';

/**
 * Constant jobQueues
 *
 * @description
 * Every queue of this service, given as is to `provisionJobs` (`src/migrate.ts`, as the migrator
 * role) and to `JobsModule` (`src/app.module.ts`, as the application role): a queue missing from
 * the database stops the start-up, and a changed declaration reaches the database at the next
 * migration run. Every payload holds ids only, never a code nor an address.
 *
 * `email.send-code` is tuned to a code that stops working 10 minutes after it was issued:
 *
 * - 4 retries with backoff from 10 seconds, capped at 2 minutes: the last attempt starts within
 *   about 5 minutes, and the handler skips a code that expired in between;
 * - an attempt is failed after 120 seconds, well above the SMTP timeouts of the sender (10 seconds
 *   to connect, 10 to greet, 30 of silence), so an attempt is not retried while it still sends;
 * - a job that waited 15 minutes without starting is deleted: its code would be expired, and the
 *   sweep settles its delivery;
 * - finished rows are deleted after an hour and dead letters after a day.
 *
 * `email.expire-codes` runs a short statement: two retries, a minute each.
 *
 * @type {readonly JobQueueDeclaration[]}
 */
export const jobQueues: readonly JobQueueDeclaration[] = [
  {
    name: SEND_CODE_EMAIL_QUEUE,
    retryLimit: SEND_CODE_EMAIL_MAX_ATTEMPTS - 1,
    retryDelaySeconds: 10,
    retryBackoff: true,
    retryDelayMaxSeconds: 120,
    expireInSeconds: 120,
    retentionSeconds: 900,
    deleteAfterSeconds: 3_600,
    deadLetterRetentionSeconds: 86_400,
  },
  {
    name: EXPIRE_CODE_EMAILS_QUEUE,
    retryLimit: 2,
    retryDelaySeconds: 30,
    retryBackoff: false,
    expireInSeconds: 60,
    retentionSeconds: 900,
    deleteAfterSeconds: 3_600,
    deadLetterRetentionSeconds: 86_400,
  },
];
