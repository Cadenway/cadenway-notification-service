import { readFileSync } from 'node:fs';
import { parseEnv } from 'node:util';

import { ConfigError, loadConfig } from '@cadenway/nest-common';
import { describe, expect, it } from 'vitest';

import { notificationIdentityTestKey } from '../../tests/support/notification-identity-test-config.js';
import { appConfigSchema, migrationConfigSchema } from './app-config.js';

describe('appConfigSchema', () => {
  const trustedIssuers: string =
    '{"api-gateway":[{"kty":"OKP","crv":"Ed25519","x":"MVZQc5h6AXxnMpaBTaYw5kI-yWWawl6zp8Srhuf5NK0","kid":"local-placeholder"}]}';
  const notificationKey = notificationIdentityTestKey();
  const complete: Readonly<Record<string, string>> = {
    PORT: '3016',
    DATABASE_URL: 'postgres://notification_app:notification_app@localhost:5432/notification',
    NATS_URL: 'nats://localhost:4222',
    NATS_USER: 'notification',
    NATS_PASSWORD: 'notification',
    INTERNAL_TOKEN_AUDIENCE: 'notification-service',
    INTERNAL_TOKEN_TRUSTED_ISSUERS: trustedIssuers,
    INTERNAL_TOKEN_PRIVATE_JWK: JSON.stringify(notificationKey),
    IDENTITY_SERVICE_URL: 'http://identity-service:3010/',
    SMTP_HOST: 'localhost',
    SMTP_PORT: '1025',
    MAIL_FROM: 'no-reply@cadenway.localhost',
  };

  it('reads the variables of the service with the defaults of the kit', () => {
    expect(loadConfig(appConfigSchema, complete)).toEqual({
      NODE_ENV: 'production',
      PORT: 3016,
      LOG_LEVEL: 'info',
      LOG_PRETTY: false,
      DATABASE_URL: 'postgres://notification_app:notification_app@localhost:5432/notification',
      DATABASE_TRANSACTION_MAX_ATTEMPTS: 3,
      NATS_URL: 'nats://localhost:4222',
      NATS_USER: 'notification',
      NATS_PASSWORD: 'notification',
      INTERNAL_TOKEN_AUDIENCE: 'notification-service',
      INTERNAL_TOKEN_PRIVATE_JWK: notificationKey,
      IDENTITY_SERVICE_URL: 'http://identity-service:3010',
      INTERNAL_TOKEN_TRUSTED_ISSUERS: {
        'api-gateway': [
          {
            kty: 'OKP',
            crv: 'Ed25519',
            x: 'MVZQc5h6AXxnMpaBTaYw5kI-yWWawl6zp8Srhuf5NK0',
            kid: 'local-placeholder',
          },
        ],
      },
      SMTP_HOST: 'localhost',
      SMTP_PORT: 1025,
      MAIL_FROM: 'no-reply@cadenway.localhost',
      WEB_APP_URL: 'http://app.cadenway.localhost',
    });
  });

  it('accepts a single database attempt and refuses a non-positive limit', () => {
    expect(
      loadConfig(appConfigSchema, { ...complete, DATABASE_TRANSACTION_MAX_ATTEMPTS: '1' })
        .DATABASE_TRANSACTION_MAX_ATTEMPTS,
    ).toBe(1);
    expect(() =>
      loadConfig(appConfigSchema, { ...complete, DATABASE_TRANSACTION_MAX_ATTEMPTS: '0' }),
    ).toThrow(/DATABASE_TRANSACTION_MAX_ATTEMPTS/u);
  });

  it('boots with activity delivery dormant using the committed environment example', () => {
    const example: NodeJS.Dict<string> = parseEnv(
      readFileSync(new URL('../../.env.example', import.meta.url), 'utf8'),
    );

    const dormant = loadConfig(appConfigSchema, example);
    expect(dormant.IDENTITY_SERVICE_URL).toBeUndefined();
    expect(dormant.INTERNAL_TOKEN_PRIVATE_JWK).toBeUndefined();
    expect(() => loadConfig(migrationConfigSchema, example)).not.toThrow();
  });

  it.each(['IDENTITY_SERVICE_URL', 'INTERNAL_TOKEN_PRIVATE_JWK'])(
    'rejects a partially provisioned runtime without %s',
    (field) => {
      expect(() => loadConfig(appConfigSchema, { ...complete, [field]: '' })).toThrow(
        new RegExp(field, 'u'),
      );
    },
  );

  it('refuses to start without the database, the broker, the audience or the trusted issuers', () => {
    expect(() => loadConfig(appConfigSchema, { PORT: '3016' })).toThrow(ConfigError);
    try {
      loadConfig(appConfigSchema, { PORT: '3016' });
    } catch (error) {
      const issues: readonly string[] = (error as ConfigError).issues;
      expect(issues.map((issue) => issue.split(':')[0])).toEqual(
        expect.arrayContaining([
          'DATABASE_URL',
          'NATS_URL',
          'INTERNAL_TOKEN_AUDIENCE',
          'INTERNAL_TOKEN_TRUSTED_ISSUERS',
          'SMTP_HOST',
          'SMTP_PORT',
          'MAIL_FROM',
        ]),
      );
    }
  });

  it.each([
    'ftp://identity-service:3010',
    'http://identity-service:3010/internal',
    'http://identity-service:3010/?token=sentinel',
    'http://test:sentinel@identity-service:3010',
  ])('refuses an Identity URL that is not a bare HTTP origin', (url) => {
    const env = { ...complete, IDENTITY_SERVICE_URL: url };
    expect(() => loadConfig(appConfigSchema, env)).toThrow(/IDENTITY_SERVICE_URL/u);
    expect(() => loadConfig(appConfigSchema, env)).not.toThrow(/sentinel/u);
  });

  it('refuses a database URL that is not PostgreSQL, without printing it', () => {
    const secret: string = 'mysql://notification_app:s3cret@localhost/notification';

    expect(() => loadConfig(appConfigSchema, { ...complete, DATABASE_URL: secret })).toThrow(
      /DATABASE_URL/u,
    );
    expect(() => loadConfig(appConfigSchema, { ...complete, DATABASE_URL: secret })).not.toThrow(
      /s3cret/u,
    );
  });

  it('refuses a broker URL that is not NATS, without printing it', () => {
    const secret: string = 'http://notification:s3cret@localhost:4222';

    expect(() => loadConfig(appConfigSchema, { ...complete, NATS_URL: secret })).toThrow(
      /NATS_URL/u,
    );
    expect(() => loadConfig(appConfigSchema, { ...complete, NATS_URL: secret })).not.toThrow(
      /s3cret/u,
    );
  });

  it('refuses a private key listed as a verification key', () => {
    const withPrivateKey: string = trustedIssuers.replace('"kid"', `"d":"${'A'.repeat(43)}","kid"`);

    expect(() =>
      loadConfig(appConfigSchema, { ...complete, INTERNAL_TOKEN_TRUSTED_ISSUERS: withPrivateKey }),
    ).toThrow(/INTERNAL_TOKEN_TRUSTED_ISSUERS/u);
  });

  it('reads the SMTP account when both its user and its password are set', () => {
    expect(
      loadConfig(appConfigSchema, {
        ...complete,
        SMTP_USER: 'notification',
        SMTP_PASSWORD: 's3cret',
      }),
    ).toMatchObject({ SMTP_USER: 'notification', SMTP_PASSWORD: 's3cret' });
  });

  it('treats an empty SMTP account, as in .env.example, as no account', () => {
    const config: Readonly<Record<string, unknown>> = loadConfig(appConfigSchema, {
      ...complete,
      SMTP_USER: '',
      SMTP_PASSWORD: '',
    });

    expect(config).not.toHaveProperty('SMTP_USER');
    expect(config).not.toHaveProperty('SMTP_PASSWORD');
  });

  it('refuses an SMTP user without its password, and the reverse, without printing them', () => {
    expect(() => loadConfig(appConfigSchema, { ...complete, SMTP_USER: 'notification' })).toThrow(
      /SMTP_PASSWORD: required, not set/u,
    );
    expect(() => loadConfig(appConfigSchema, { ...complete, SMTP_PASSWORD: 's3cret' })).toThrow(
      /SMTP_USER: required, not set/u,
    );
    expect(() => loadConfig(appConfigSchema, { ...complete, SMTP_PASSWORD: 's3cret' })).not.toThrow(
      /s3cret/u,
    );
  });

  it('refuses an SMTP port out of range and a sender that is not an address', () => {
    expect(() => loadConfig(appConfigSchema, { ...complete, SMTP_PORT: '70000' })).toThrow(
      /SMTP_PORT/u,
    );
    expect(() => loadConfig(appConfigSchema, { ...complete, MAIL_FROM: 'Cadenway' })).toThrow(
      /MAIL_FROM: Expected the sender e-mail address/u,
    );
  });

  it('reads the origin of the web application without its trailing slash', () => {
    expect(
      loadConfig(appConfigSchema, { ...complete, WEB_APP_URL: 'https://app.cadenway.fr/' }),
    ).toMatchObject({ WEB_APP_URL: 'https://app.cadenway.fr' });
    expect(() =>
      loadConfig(appConfigSchema, { ...complete, WEB_APP_URL: 'ftp://app.cadenway.fr' }),
    ).toThrow(/WEB_APP_URL/u);
  });

  it('does not read the migrator URL: the running service never needs it', () => {
    expect(loadConfig(appConfigSchema, complete)).not.toHaveProperty('MIGRATION_DATABASE_URL');
  });
});

describe('migrationConfigSchema', () => {
  it('reads the URL of the migrator role', () => {
    expect(
      loadConfig(migrationConfigSchema, {
        MIGRATION_DATABASE_URL:
          'postgres://notification_migrator:notification_migrator@localhost:5432/notification',
      }),
    ).toEqual({
      MIGRATION_DATABASE_URL:
        'postgres://notification_migrator:notification_migrator@localhost:5432/notification',
    });
  });

  it('names MIGRATION_DATABASE_URL when it is missing', () => {
    expect(() =>
      loadConfig(migrationConfigSchema, {
        DATABASE_URL: 'postgres://notification_app:notification_app@localhost:5432/notification',
      }),
    ).toThrow(/MIGRATION_DATABASE_URL: required, not set/u);
  });

  it('names MIGRATION_DATABASE_URL when it is not a PostgreSQL URL, without printing it', () => {
    const secret: string = 'mysql://notification_migrator:s3cret@localhost/notification';

    expect(() => loadConfig(migrationConfigSchema, { MIGRATION_DATABASE_URL: secret })).toThrow(
      /MIGRATION_DATABASE_URL: Expected the postgres:\/\/ URL of the migrator role/u,
    );
    expect(() => loadConfig(migrationConfigSchema, { MIGRATION_DATABASE_URL: secret })).not.toThrow(
      /s3cret/u,
    );
  });
});
