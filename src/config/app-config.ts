import { baseConfigShape, internalTokenVerifierConfigShape } from '@cadenway/nest-common';
import type { BaseConfig, InternalTokenVerifierConfig } from '@cadenway/nest-common';
import { databaseConfigShape } from '@cadenway/nest-common/database';
import type { DatabaseConfig } from '@cadenway/nest-common/database';
import { messagingConfigShape } from '@cadenway/nest-messaging';
import type { MessagingConfig } from '@cadenway/nest-messaging';
import { z } from 'zod';

/**
 * Type AppConfig
 *
 * @description
 * Variables the running service reads, validated when the application is created: by `loadConfig`
 * in `main.ts` for the options of `createApplication`, and by `ConfigModule` for the providers that
 * inject `CONFIG`.
 *
 * - `NODE_ENV`, `PORT`, `LOG_LEVEL`, `LOG_PRETTY`: `baseConfigShape` of `@cadenway/nest-common`;
 *   `PORT` is required, the others default to `production`, `info` and `false`.
 * - `DATABASE_URL`: the application role of this service's own database (`notification_app`),
 *   subject to row-level security and holding no DDL right.
 * - `NATS_URL`, `NATS_USER`, `NATS_PASSWORD`: `messagingConfigShape` of `@cadenway/nest-messaging`.
 *   `NATS_URL` is required; the user (`notification`) and its password are optional for the kit,
 *   which accepts an anonymous local broker, but every broker of Cadenway refuses a connection
 *   without them.
 * - `INTERNAL_TOKEN_AUDIENCE` and `INTERNAL_TOKEN_TRUSTED_ISSUERS`: the `aud` this service accepts
 *   and the public keys of the backends allowed to call it.
 *
 * - `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASSWORD`, `MAIL_FROM` and `WEB_APP_URL`: the
 *   outgoing e-mail, see `EmailConfig`.
 *
 * `OTEL_EXPORTER_OTLP_ENDPOINT` is read by `telemetry.ts`, before the application exists.
 *
 * @type {BaseConfig & DatabaseConfig & MessagingConfig & InternalTokenVerifierConfig & EmailConfig}
 */
export type AppConfig = BaseConfig &
  DatabaseConfig &
  MessagingConfig &
  InternalTokenVerifierConfig &
  EmailConfig;

/** Readiness listener, database and SMTP settings needed by the background process. */
export type WorkerConfig = BaseConfig & DatabaseConfig & EmailConfig;

/**
 * Interface EmailConfig
 *
 * @description
 * Variables of the outgoing e-mail. cadenway-ops passes the account of the e-mail provider on a
 * server (`docs/service-environment.md` there); locally they point at Mailpit, which asks for no
 * account. None of them is ever logged.
 */
export interface EmailConfig {
  // #region Properties
  /**
   * Property SMTP_HOST
   *
   * @description
   * Host name of the SMTP server: `localhost` for the Mailpit of `compose.dev.yaml`, `mailpit` in
   * the stack of cadenway-ops, the relay of the provider on a server.
   *
   * @type {string}
   * @readonly
   */
  readonly SMTP_HOST: string;

  /**
   * Property SMTP_PORT
   *
   * @description
   * Port of the SMTP server, from 1 to 65535. Port 465 opens the connection in TLS; any other port
   * starts in clear and upgrades with STARTTLS when the server offers it, which is required as
   * soon as an account is set.
   *
   * @type {number}
   * @readonly
   */
  readonly SMTP_PORT: number;

  /**
   * Property SMTP_USER
   *
   * @description
   * Account on the SMTP server; unset (or empty) for a server that asks for none, such as Mailpit.
   * Set together with `SMTP_PASSWORD`.
   *
   * @type {string | undefined}
   * @readonly
   */
  readonly SMTP_USER?: string;

  /**
   * Property SMTP_PASSWORD
   *
   * @description
   * Password of `SMTP_USER`. A secret, kept in cadenway-ops and never logged.
   *
   * @type {string | undefined}
   * @readonly
   */
  readonly SMTP_PASSWORD?: string;

  /**
   * Property MAIL_FROM
   *
   * @description
   * Sender address of every e-mail, shown as `Cadenway <MAIL_FROM>`; its domain also names the
   * `Message-ID` of each e-mail.
   *
   * @type {string}
   * @readonly
   */
  readonly MAIL_FROM: string;

  /**
   * Property WEB_APP_URL
   *
   * @description
   * Origin of the web application, without a trailing slash, from which the links of the e-mails
   * are built: the manage-notifications page of `List-Unsubscribe` and the buttons of the
   * templates. `deploy/compose.yaml` builds it from the `PUBLIC_SCHEME` and `DOMAIN` of each
   * environment; unset, it is `http://app.cadenway.localhost`, the web application of the local
   * stack of cadenway-ops.
   *
   * @type {string}
   * @readonly
   */
  readonly WEB_APP_URL: string;
  // #endregion
}

/**
 * Constant LOCAL_WEB_APP_URL
 *
 * @description
 * Origin of the web application of the local stack of cadenway-ops (`PUBLIC_SCHEME=http`,
 * `DOMAIN=cadenway.localhost`), the value of `WEB_APP_URL` when it is not set. Every environment
 * of cadenway-ops sets the variable through `deploy/compose.yaml`.
 *
 * @type {string}
 */
const LOCAL_WEB_APP_URL: string = 'http://app.cadenway.localhost';

const emailConfigSchema = z
  .object({
    SMTP_HOST: z.string().min(1),
    SMTP_PORT: z.coerce.number().int().min(1).max(65_535),
    SMTP_USER: z.string().min(1).optional(),
    SMTP_PASSWORD: z.string().min(1).optional(),
    MAIL_FROM: z.email({ error: 'Expected the sender e-mail address.' }),
    WEB_APP_URL: z
      .url({ protocol: /^https?$/u, error: 'Expected the http:// or https:// origin of the app.' })
      .default(LOCAL_WEB_APP_URL)
      .transform((url) => url.replace(/\/+$/u, '')),
  })
  .superRefine((config, context) => {
    if ((config.SMTP_USER === undefined) !== (config.SMTP_PASSWORD === undefined)) {
      context.addIssue({
        code: 'custom',
        path: [config.SMTP_USER === undefined ? 'SMTP_USER' : 'SMTP_PASSWORD'],
        message: 'SMTP_USER and SMTP_PASSWORD are set together or not at all.',
      });
    }
  });

/** Validates the worker's environment, whose readiness listener binds only to loopback. */
export const workerConfigSchema: z.ZodType<WorkerConfig> = emailConfigSchema.safeExtend({
  ...baseConfigShape,
  ...databaseConfigShape,
});

/**
 * Constant appConfigSchema
 *
 * @description
 * Zod schema of `AppConfig`, composed from the shapes of `@cadenway/nest-common` and
 * `@cadenway/nest-messaging` so the names, defaults and validation stay those of the kit, and from
 * the variables of the outgoing e-mail. A missing or invalid variable makes `loadConfig` throw a
 * `ConfigError` that names it without printing its value. An empty variable counts as unset, so
 * the empty `SMTP_USER` and `SMTP_PASSWORD` of `.env.example` mean "no account"; the two are set
 * together or not at all.
 *
 * @type {z.ZodType<AppConfig>}
 */
export const appConfigSchema: z.ZodType<AppConfig> = emailConfigSchema.safeExtend({
  ...baseConfigShape,
  ...databaseConfigShape,
  ...messagingConfigShape,
  ...internalTokenVerifierConfigShape,
});

/**
 * Interface MigrationConfig
 *
 * @description
 * Variable the one-off migration container reads (`node dist/migrate.js`). The running service
 * never reads it: only the migrator role may change the structure of the database.
 */
export interface MigrationConfig {
  // #region Properties
  /**
   * Property MIGRATION_DATABASE_URL
   *
   * @description
   * Connection string of the migrator role (`notification_migrator`), which owns the tables and
   * runs the DDL. A secret; cadenway-ops passes it from
   * `NOTIFICATION_SERVICE_MIGRATION_DATABASE_URL`.
   *
   * @type {string}
   * @readonly
   */
  readonly MIGRATION_DATABASE_URL: string;
  // #endregion
}

/**
 * Constant migrationConfigSchema
 *
 * @description
 * Zod schema of `MigrationConfig`: a `postgres://` or `postgresql://` URL, like `DATABASE_URL`.
 *
 * @type {z.ZodType<MigrationConfig>}
 */
export const migrationConfigSchema: z.ZodType<MigrationConfig> = z.object({
  MIGRATION_DATABASE_URL: z.url({
    protocol: /^postgres(?:ql)?$/u,
    error: 'Expected the postgres:// URL of the migrator role.',
  }),
});
