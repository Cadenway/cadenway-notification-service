import 'reflect-metadata';

import { generateKeyPairSync } from 'node:crypto';
import type { Server } from 'node:http';

import {
  EtagInterceptor,
  InternalTokenGuard,
  InternalTokenSigner,
  InternalTokenVerifier,
  ProblemFilter,
} from '@cadenway/nest-common';
import type { Ed25519PrivateJwk, Ed25519PublicJwk } from '@cadenway/nest-common';
import { Reflector } from '@nestjs/core';
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { PlatformModule } from '../../../../../platform/platform.module.js';

import { PreferencesVersionMismatch } from '../../../../application/models/preferences/preferences-version-mismatch.model.js';
import { UpdateNotificationPreferences } from '../../../../application/use-cases/commands/preferences/update-notification-preferences/update-notification-preferences.use-case.js';
import { GetNotificationPreferences } from '../../../../application/use-cases/queries/preferences/get-notification-preferences/get-notification-preferences.use-case.js';
import { NotificationPreferences } from '../../../../domain/aggregates/preferences/notification-preferences.aggregate.js';
import { NotificationPreferencesController } from './notification-preferences.controller.js';

const account = '01938f6e-8a42-7d5b-b2c9-5e1f3a6d9c24';
const path = '/internal/v1/me/notification-preferences';

describe('NotificationPreferencesController', () => {
  let app: INestApplication;
  let gateway: InternalTokenSigner;
  let otherIssuer: InternalTokenSigner;
  const get = vi.fn();
  const update = vi.fn();

  beforeAll(async () => {
    const keys = generateKeyPairSync('ed25519');
    const privateKey = {
      ...keys.privateKey.export({ format: 'jwk' }),
      kid: 'test',
    } as Ed25519PrivateJwk;
    const publicKey = {
      ...keys.publicKey.export({ format: 'jwk' }),
      kid: 'test',
    } as Ed25519PublicJwk;
    gateway = await InternalTokenSigner.create({ issuer: 'api-gateway', privateJwk: privateKey });
    otherIssuer = await InternalTokenSigner.create({
      issuer: 'other-service',
      privateJwk: privateKey,
    });
    const verifier = await InternalTokenVerifier.create({
      audience: 'notification-service',
      trustedIssuers: { 'api-gateway': [publicKey], 'other-service': [publicKey] },
    });
    const module = await Test.createTestingModule({
      imports: [PlatformModule],
      controllers: [NotificationPreferencesController],
      providers: [
        { provide: GetNotificationPreferences, useValue: { execute: get } },
        { provide: UpdateNotificationPreferences, useValue: { execute: update } },
      ],
    }).compile();
    app = module.createNestApplication();
    app.useGlobalGuards(new InternalTokenGuard(verifier, new Reflector()));
    app.useGlobalInterceptors(new EtagInterceptor());
    app.useGlobalFilters(new ProblemFilter());
    await app.init();
  });

  beforeEach(() => {
    get.mockReset();
    update.mockReset();
    get.mockResolvedValue(NotificationPreferences.defaults(account).snapshot);
    update.mockResolvedValue(NotificationPreferences.defaults(account).snapshot);
  });

  afterAll(async () => app.close());

  it('reads defaults without an organization and does not expose the account id', async () => {
    const token = await gateway.sign('notification-service', {
      actor: { type: 'user', id: account },
      organizationId: null,
    });
    const response = await request(app.getHttpServer() as Server)
      .get(path)
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
    expect(response.headers.etag).toBe('"1"');
    expect(response.body).toMatchObject({ version: 1, digest: 'daily', doNotDisturb: true });
    expect(response.body).not.toHaveProperty('userId');
    expect(get).toHaveBeenCalledExactlyOnceWith({ userId: account });
  });

  it('returns the documented unavailable problem for a nested database connection failure', async () => {
    const token = await gateway.sign('notification-service', {
      actor: { type: 'user', id: account },
      organizationId: null,
    });
    const failure = Object.assign(new Error('private database host'), { code: 'ECONNREFUSED' });
    get.mockRejectedValue(new Error('query with private values', { cause: failure }));
    const response = await request(app.getHttpServer() as Server)
      .get(path)
      .set('Authorization', `Bearer ${token}`)
      .expect(503);
    expect(response.body).toMatchObject({ code: 'upstream.unavailable' });
    expect(JSON.stringify(response.body)).not.toContain('private');
  });

  it('keeps programming and constraint errors as unexpected failures', async () => {
    const token = await gateway.sign('notification-service', {
      actor: { type: 'user', id: account },
      organizationId: null,
    });
    for (const code of ['23505', '42601']) {
      get.mockRejectedValueOnce(Object.assign(new Error('private query'), { code }));
      const response = await request(app.getHttpServer() as Server)
        .get(path)
        .set('Authorization', `Bearer ${token}`)
        .expect(500);
      expect(response.body).toMatchObject({ code: 'internal.unexpected' });
      expect(JSON.stringify(response.body)).not.toContain('private');
    }
  });

  it('returns the required representation on a conditional GET', async () => {
    const token = await gateway.sign('notification-service', {
      actor: { type: 'user', id: account },
      organizationId: null,
    });
    for (const tag of ['"1"', '*']) {
      const response = await request(app.getHttpServer() as Server)
        .get(path)
        .set('Authorization', `Bearer ${token}`)
        .set('If-None-Match', tag)
        .expect(200);
      expect(response.headers.etag).toBe('"1"');
      expect(response.body).toMatchObject({ version: 1 });
    }
  });

  it('rejects missing tokens and an unapproved issuer or actor', async () => {
    await request(app.getHttpServer() as Server)
      .get(path)
      .expect(401);
    const issuer = await otherIssuer.sign('notification-service', {
      actor: { type: 'user', id: account },
      organizationId: null,
    });
    const actor = await gateway.sign('notification-service', {
      actor: { type: 'system', id: null },
      organizationId: null,
    });
    await request(app.getHttpServer() as Server)
      .get(path)
      .set('Authorization', `Bearer ${issuer}`)
      .expect(403);
    await request(app.getHttpServer() as Server)
      .get(path)
      .set('Authorization', `Bearer ${actor}`)
      .expect(403);
    expect(get).not.toHaveBeenCalled();
  });

  it('validates the patch and passes all strong If-Match versions to the transaction', async () => {
    const token = await gateway.sign('notification-service', {
      actor: { type: 'user', id: account },
      organizationId: null,
    });
    await request(app.getHttpServer() as Server)
      .patch(path)
      .set('Authorization', `Bearer ${token}`)
      .set('If-Match', '"1", "2"')
      .send({ channels: { comment: { email: true } } })
      .expect(200);
    expect(update).toHaveBeenCalledExactlyOnceWith({
      userId: account,
      patch: { channels: { comment: { email: true } } },
      expectedVersions: [1, 2],
    });
    await request(app.getHttpServer() as Server)
      .patch(path)
      .set('Authorization', `Bearer ${token}`)
      .send({ digest: null })
      .expect(400);
    expect(update).toHaveBeenCalledTimes(1);
  });

  it('returns the current version and strong ETag when an update loses a race', async () => {
    update.mockRejectedValue(new PreferencesVersionMismatch(4));
    const token = await gateway.sign('notification-service', {
      actor: { type: 'user', id: account },
      organizationId: null,
    });
    const response = await request(app.getHttpServer() as Server)
      .patch(path)
      .set('Authorization', `Bearer ${token}`)
      .set('If-Match', '"3"')
      .send({ digest: 'weekly' })
      .expect(412);
    expect(response.headers.etag).toBe('"4"');
    expect(response.body).toMatchObject({
      code: 'request.version-mismatch',
      details: { version: 4 },
    });
  });

  it('passes the wildcard and rejects a malformed If-Match header', async () => {
    const token = await gateway.sign('notification-service', {
      actor: { type: 'user', id: account },
      organizationId: null,
    });
    await request(app.getHttpServer() as Server)
      .patch(path)
      .set('Authorization', `Bearer ${token}`)
      .set('If-Match', '*')
      .send({})
      .expect(200);
    expect(update).toHaveBeenCalledExactlyOnceWith({
      userId: account,
      patch: {},
      expectedVersions: '*',
    });
    await request(app.getHttpServer() as Server)
      .patch(path)
      .set('Authorization', `Bearer ${token}`)
      .set('If-Match', 'not-an-etag')
      .send({})
      .expect(400);
    expect(update).toHaveBeenCalledTimes(1);
  });
});
