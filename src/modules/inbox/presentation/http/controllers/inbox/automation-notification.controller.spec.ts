import 'reflect-metadata';

import { generateKeyPairSync } from 'node:crypto';
import type { Server } from 'node:http';

import { CreateAutomationNotificationInternalResponse } from '@cadenway/contracts/validators/internal/notification-service';
import {
  InternalTokenGuard,
  InternalTokenSigner,
  InternalTokenVerifier,
  ProblemException,
} from '@cadenway/nest-common';
import type { Ed25519PrivateJwk, Ed25519PublicJwk } from '@cadenway/nest-common';
import type { INestApplication } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Test } from '@nestjs/testing';
import { of } from 'rxjs';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { RecordAutomationNotification } from '../../../../application/use-cases/commands/inbox/record-automation-notification/record-automation-notification.use-case.js';
import { AuthorizeAutomationNotification } from '../../../../application/use-cases/queries/inbox/authorize-automation-notification/authorize-automation-notification.use-case.js';
import { AutomationNotificationController } from './automation-notification.controller.js';

const audience = 'notification-service';
const path = '/internal/v1/inbox/automation-notifications';
const organizationId = '019a7000-1a2b-7c3d-8e4f-5a6b7c8d9e03';
const ruleId = '019a7000-1a2b-7c3d-8e4f-5a6b7c8d9e01';
const commandKey = 'p6-notify';
const body = {
  taskKey: 'CAD-482',
  ruleAuthorUserId: '019a7000-1a2b-7c3d-8e4f-5a6b7c8d9e02',
  recipientUserId: '019a7000-1a2b-7c3d-8e4f-5a6b7c8d9e04',
} as const;

describe('Automation notification command', () => {
  let app: INestApplication;
  let token: string;
  let gatewayToken: string;
  let uppercaseRuleToken: string;
  let tenantlessToken: string;
  const authorize = vi.fn();
  const execute = vi.fn();
  const readReceipt = vi.fn();

  beforeAll(async () => {
    const keys = generateKeyPairSync('ed25519');
    const privateJwk = {
      ...keys.privateKey.export({ format: 'jwk' }),
      kid: 'test',
    } as Ed25519PrivateJwk;
    const publicJwk = {
      ...keys.publicKey.export({ format: 'jwk' }),
      kid: 'test',
    } as Ed25519PublicJwk;
    const signer = await InternalTokenSigner.create({ issuer: 'automation-service', privateJwk });
    const gateway = await InternalTokenSigner.create({ issuer: 'api-gateway', privateJwk });
    const claims = { organizationId, actor: { type: 'automation', id: ruleId } } as const;
    token = await signer.sign(audience, claims);
    gatewayToken = await gateway.sign(audience, {
      organizationId,
      actor: { type: 'user', id: body.ruleAuthorUserId },
    });
    uppercaseRuleToken = await signer.sign(audience, {
      ...claims,
      actor: { type: 'automation', id: ruleId.toUpperCase() },
    });
    tenantlessToken = await signer.sign(audience, { ...claims, organizationId: null });

    const verifier = await InternalTokenVerifier.create({
      audience,
      trustedIssuers: { 'automation-service': [publicJwk], 'api-gateway': [publicJwk] },
    });
    const module = await Test.createTestingModule({
      controllers: [AutomationNotificationController],
      providers: [
        {
          provide: AuthorizeAutomationNotification,
          useValue: new AuthorizeAutomationNotification({ authorize }),
        },
        { provide: RecordAutomationNotification, useValue: { execute } },
      ],
    }).compile();
    app = module.createNestApplication();
    app.useGlobalGuards(new InternalTokenGuard(verifier, new Reflector()));
    app.useGlobalInterceptors({
      intercept: (_context, next) =>
        readReceipt() === true ? of({ disposition: 'applied' }) : next.handle(),
    });
    await app.init();
  });

  afterAll(async () => app.close());

  beforeEach(() => {
    authorize.mockReset().mockResolvedValue('allowed');
    execute.mockReset().mockResolvedValue({ disposition: 'applied' });
    readReceipt.mockReset().mockReturnValue(false);
  });

  function post(url = path, bearer = token) {
    return request(app.getHttpServer() as Server)
      .post(url)
      .set('Authorization', `Bearer ${bearer}`);
  }

  it.each(['applied', 'no_op'] as const)('returns the private %s receipt', async (disposition) => {
    execute.mockResolvedValueOnce({ disposition });
    const response = await post().set('Idempotency-Key', commandKey).send(body).expect(200);
    expect(response.headers['cache-control']).toBe('private, no-store');
    expect(CreateAutomationNotificationInternalResponse.parse(response.body)).toEqual({
      disposition,
    });
    expect(authorize).toHaveBeenCalledExactlyOnceWith({ organizationId, ...body });
    expect(execute).toHaveBeenCalledExactlyOnceWith({
      organizationId,
      ...body,
      ruleId,
      commandKey,
    });
    expect(authorize.mock.invocationCallOrder[0]).toBeLessThan(
      readReceipt.mock.invocationCallOrder[0] ?? 0,
    );
  });

  it('checks live Task authority before each replay and conceals revocation', async () => {
    readReceipt.mockReturnValue(true);
    await post().set('Idempotency-Key', commandKey).send(body).expect(200);
    authorize.mockResolvedValueOnce('denied');
    const revoked = await post().set('Idempotency-Key', commandKey).send(body).expect(404);
    expect(revoked.body).toMatchObject({ code: 'notification.not-found' });
    expect(revoked.text).not.toContain(body.taskKey);
    expect(revoked.text).not.toContain(body.recipientUserId);
    expect(revoked.headers['cache-control']).toBe('private, no-store');
    expect(authorize).toHaveBeenCalledTimes(2);
    expect(readReceipt).toHaveBeenCalledTimes(1);
    expect(execute).not.toHaveBeenCalled();
  });

  it.each(['adapter', 'transaction'] as const)('conceals a failing %s', async (stage) => {
    const failure = new Error('private task or database details');
    (stage === 'adapter' ? authorize : execute).mockRejectedValueOnce(failure);
    const response = await post().set('Idempotency-Key', commandKey).send(body).expect(503);
    expect(response.body).toMatchObject({ code: 'upstream.unavailable' });
    expect(response.text).not.toContain(failure.message);
    expect(response.headers['cache-control']).toBe('private, no-store');
    if (stage === 'adapter') {
      expect(readReceipt).not.toHaveBeenCalled();
      expect(execute).not.toHaveBeenCalled();
    }
  });

  it('conceals an unavailable Task proof before receipt lookup', async () => {
    readReceipt.mockReturnValue(true);
    authorize.mockResolvedValueOnce('unavailable');
    await post().set('Idempotency-Key', commandKey).send(body).expect(503);
    expect(readReceipt).not.toHaveBeenCalled();
    expect(execute).not.toHaveBeenCalled();
  });

  it('requires a valid signed rule in a tenant before calling Task', async () => {
    const responses = await Promise.all([
      request(app.getHttpServer() as Server)
        .post(path)
        .send(body)
        .expect(401),
      post(path, gatewayToken).send(body).expect(403),
      post(path, uppercaseRuleToken).send(body).expect(403),
      post(path, tenantlessToken).send(body).expect(403),
    ]);
    expect(responses.map((response) => (response.body as { code: string }).code)).toEqual([
      'auth.token-missing',
      'auth.issuer-not-allowed',
      'auth.actor-not-allowed',
      'auth.organization-required',
    ]);
    for (const response of responses)
      expect(response.headers['cache-control']).toBe('private, no-store');
    expect(authorize).not.toHaveBeenCalled();
    expect(readReceipt).not.toHaveBeenCalled();
  });

  it('rejects malformed input before Task and keeps submitted data out of problems', async () => {
    const marker = 'private-marker@example.test';
    const valid = () => post().set('Idempotency-Key', commandKey);
    const responses = await Promise.all([
      post().send(body).expect(400),
      post()
        .set('Idempotency-Key', ['first', 'second'] as unknown as string)
        .send(body)
        .expect(400),
      post().set('Idempotency-Key', 'contains whitespace').send(body).expect(400),
      valid().set('Content-Type', 'text/plain').send(JSON.stringify(body)).expect(400),
      valid()
        .send({ ...body, [marker]: marker })
        .expect(400),
      valid()
        .send({ ...body, recipientUserId: marker })
        .expect(400),
      post(`${path}?${encodeURIComponent(marker)}=yes`)
        .set('Idempotency-Key', commandKey)
        .send(body)
        .expect(400),
    ]);
    for (const response of responses) {
      expect(response.headers['cache-control']).toBe('private, no-store');
      expect(response.body).toMatchObject({ code: 'request.invalid' });
      const problem = response.body as { details: { issues: unknown } };
      expect(Array.isArray(problem.details.issues)).toBe(true);
      expect(response.text).not.toContain(marker);
    }
    expect(authorize).not.toHaveBeenCalled();
    expect(readReceipt).not.toHaveBeenCalled();
  });

  it('preserves the idempotency errors from the receipt layer', async () => {
    readReceipt
      .mockImplementationOnce(() => {
        throw new ProblemException({ status: 409, code: 'idempotency.request-in-progress' });
      })
      .mockImplementationOnce(() => {
        throw new ProblemException({ status: 422, code: 'idempotency.key-reused' });
      });
    for (const [status, code] of [
      [409, 'idempotency.request-in-progress'],
      [422, 'idempotency.key-reused'],
    ] as const) {
      const response = await post().set('Idempotency-Key', commandKey).send(body).expect(status);
      expect(response.body).toMatchObject({ code });
      expect(response.headers['cache-control']).toBe('private, no-store');
    }
    expect(authorize).toHaveBeenCalledTimes(2);
    expect(execute).not.toHaveBeenCalled();
  });
});
