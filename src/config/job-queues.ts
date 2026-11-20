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
 * Constant SEND_INVITATION_EMAIL_QUEUE
 *
 * @description
 * Queue of the invitation e-mails. One job per e-mail, enqueued in the tenant transaction of the
 * organization, whose payload is the id of its row in `invitation_email_deliveries` and whose
 * occurrence key is that same id, so the same e-mail is never enqueued twice.
 *
 * @type {string}
 */
export const SEND_INVITATION_EMAIL_QUEUE: string = 'email.send-invitation';

/**
 * Constant SEND_INVITATION_EMAIL_MAX_ATTEMPTS
 *
 * @description
 * Attempts an invitation e-mail gets, the first one included: `retryLimit + 1` of its queue. The
 * handler marks the delivery `failed` when the last one fails.
 *
 * @type {number}
 */
export const SEND_INVITATION_EMAIL_MAX_ATTEMPTS: number = 5;

/**
 * Constant EXPIRE_INVITATION_EMAILS_QUEUE
 *
 * @description
 * Queue of the sweep that settles the invitation e-mails whose invitation expired while they were
 * still `queued` (a last attempt failed by a crash) and deletes their address and names. Scheduled
 * by `EXPIRE_INVITATION_EMAILS_CRON`; its jobs carry no payload.
 *
 * @type {string}
 */
export const EXPIRE_INVITATION_EMAILS_QUEUE: string = 'email.expire-invitations';

/**
 * Constant EXPIRE_INVITATION_EMAILS_CRON
 *
 * @description
 * When the sweep of the invitation e-mails runs: every hour, in UTC. An invitation is valid 7
 * days, so an address outlives its invitation by an hour at most, plus the 40 seconds pg-boss takes
 * to evaluate a schedule.
 *
 * @type {string}
 */
export const EXPIRE_INVITATION_EMAILS_CRON: string = '0 * * * *';

/**
 * Constant SEND_SECURITY_EMAIL_QUEUE
 *
 * @description
 * Queue of the security e-mails of the account events of identity-service (reset link, password
 * changed, address changed, new sign-in, deletion scheduled or cancelled). One job per e-mail,
 * whose payload is the id of its row in `security_email_deliveries` and whose occurrence key is
 * that same id, so the same e-mail is never enqueued twice.
 *
 * @type {string}
 */
export const SEND_SECURITY_EMAIL_QUEUE: string = 'email.send-security';

/**
 * Constant SEND_SECURITY_EMAIL_MAX_ATTEMPTS
 *
 * @description
 * Attempts a security e-mail gets, the first one included: `retryLimit + 1` of its queue. The
 * handler marks the delivery `failed` when the last one fails.
 *
 * @type {number}
 */
export const SEND_SECURITY_EMAIL_MAX_ATTEMPTS: number = 5;

/**
 * Constant EXPIRE_SECURITY_EMAILS_QUEUE
 *
 * @description
 * Queue of the sweep that settles the security e-mails whose window closed before they could
 * leave, and deletes their address, device and reset token. Scheduled by
 * `EXPIRE_SECURITY_EMAILS_CRON`; its jobs carry no payload.
 *
 * @type {string}
 */
export const EXPIRE_SECURITY_EMAILS_QUEUE: string = 'email.expire-security';

/**
 * Constant EXPIRE_SECURITY_EMAILS_CRON
 *
 * @description
 * When the sweep of the security e-mails runs: every 5 minutes, in UTC, as for the codes. A reset
 * token outlives the expiry of its link by 5 minutes at most, plus the 40 seconds pg-boss takes to
 * evaluate a schedule.
 *
 * @type {string}
 */
export const EXPIRE_SECURITY_EMAILS_CRON: string = '*/5 * * * *';

/** Queue for the authorization check of a specific personal reminder schedule. */
export const REQUEST_REMINDER_AUTHORIZATION_QUEUE: string = 'reminder.request-authorization';

/** Queue for an Inbox authorization watchdog tied to one opaque correlation. */
export const RETRY_INBOX_DELIVERY_AUTHORIZATION_QUEUE: string =
  'inbox.retry-delivery-authorization';

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
 * `email.send-invitation` is tuned to an invitation valid 7 days, which nobody waits for on a
 * screen:
 *
 * - 4 retries with backoff from 30 seconds, capped at 10 minutes: the last attempt starts within
 *   about 15 minutes, which outlasts a short outage of the SMTP server;
 * - an attempt is failed after 120 seconds, as for the code e-mails;
 * - a job that waited 7 days without starting is deleted: its invitation would be expired, and the
 *   sweep settles its delivery;
 * - finished rows are deleted after an hour and dead letters after a day.
 *
 * `email.expire-invitations` runs a short statement, like `email.expire-codes`.
 *
 * `email.send-security` is tuned to its two kinds of e-mails: the reset link, waited for on a
 * screen and valid 30 minutes, and the notices, sent within a day of their event:
 *
 * - 4 retries with backoff from 10 seconds, capped at 2 minutes, as for the codes;
 * - an attempt is failed after 120 seconds, as for the codes;
 * - a job that waited a day without starting is deleted: its window would be closed, and the sweep
 *   settles its delivery;
 * - finished rows are deleted after an hour and dead letters after a day.
 *
 * `email.expire-security` runs a short statement, like `email.expire-codes`.
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
  {
    name: SEND_INVITATION_EMAIL_QUEUE,
    retryLimit: SEND_INVITATION_EMAIL_MAX_ATTEMPTS - 1,
    retryDelaySeconds: 30,
    retryBackoff: true,
    retryDelayMaxSeconds: 600,
    expireInSeconds: 120,
    retentionSeconds: 604_800,
    deleteAfterSeconds: 3_600,
    deadLetterRetentionSeconds: 86_400,
  },
  {
    name: EXPIRE_INVITATION_EMAILS_QUEUE,
    retryLimit: 2,
    retryDelaySeconds: 30,
    retryBackoff: false,
    expireInSeconds: 60,
    retentionSeconds: 900,
    deleteAfterSeconds: 3_600,
    deadLetterRetentionSeconds: 86_400,
  },
  {
    name: SEND_SECURITY_EMAIL_QUEUE,
    retryLimit: SEND_SECURITY_EMAIL_MAX_ATTEMPTS - 1,
    retryDelaySeconds: 10,
    retryBackoff: true,
    retryDelayMaxSeconds: 120,
    expireInSeconds: 120,
    retentionSeconds: 86_400,
    deleteAfterSeconds: 3_600,
    deadLetterRetentionSeconds: 86_400,
  },
  {
    name: EXPIRE_SECURITY_EMAILS_QUEUE,
    retryLimit: 2,
    retryDelaySeconds: 30,
    retryBackoff: false,
    expireInSeconds: 60,
    retentionSeconds: 900,
    deleteAfterSeconds: 3_600,
    deadLetterRetentionSeconds: 86_400,
  },
  {
    name: RETRY_INBOX_DELIVERY_AUTHORIZATION_QUEUE,
    retryLimit: 4,
    retryDelaySeconds: 10,
    retryBackoff: true,
    retryDelayMaxSeconds: 120,
    expireInSeconds: 60,
    retentionSeconds: 86_400,
    deleteAfterSeconds: 3_600,
    deadLetterRetentionSeconds: 86_400,
  },
  {
    name: REQUEST_REMINDER_AUTHORIZATION_QUEUE,
    retryLimit: 4,
    retryDelaySeconds: 10,
    retryBackoff: true,
    retryDelayMaxSeconds: 120,
    expireInSeconds: 60,
    retentionSeconds: 86_400,
    deleteAfterSeconds: 3_600,
    deadLetterRetentionSeconds: 86_400,
  },
];
