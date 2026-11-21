import 'reflect-metadata';

import { generateKeyPairSync, randomUUID } from 'node:crypto';
import type { Server } from 'node:http';

import {
  InternalTokenGuard,
  InternalTokenSigner,
  InternalTokenVerifier,
  ProblemFilter,
} from '@cadenway/nest-common';
import type { Ed25519PrivateJwk, Ed25519PublicJwk } from '@cadenway/nest-common';
import type { INestApplication } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { SubmitContact } from '../../../../application/use-cases/commands/forms/submit-contact/submit-contact.use-case.js';
import { SubscribeNewsletter } from '../../../../application/use-cases/commands/forms/subscribe-newsletter/subscribe-newsletter.use-case.js';
import { SITE_CONTACT_ENABLED, SiteFormsController } from './site-forms.controller.js';

const contactPath = '/internal/v1/contact-submissions';
const newsletterPath = '/internal/v1/newsletter-subscriptions';
const body = {
  email: 'camille.martin@ateliernord.fr',
  subject: 'login',
  message: 'Je ne parviens plus à me connecter à mon compte.',
};

describe('SiteFormsController', () => {
  let app: INestApplication;
  let signer: InternalTokenSigner;
  let token: string;
  const submit = vi.fn();
  const subscribe = vi.fn();

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
    signer = await InternalTokenSigner.create({ issuer: 'api-gateway', privateJwk: privateKey });
    const verifier = await InternalTokenVerifier.create({
      audience: 'notification-service',
      trustedIssuers: { 'api-gateway': [publicKey] },
    });
    const module = await Test.createTestingModule({
      controllers: [SiteFormsController],
      providers: [
        { provide: SubmitContact, useValue: { execute: submit } },
        { provide: SubscribeNewsletter, useValue: { execute: subscribe } },
        { provide: SITE_CONTACT_ENABLED, useValue: true },
      ],
    }).compile();
    app = module.createNestApplication();
    app.useGlobalGuards(new InternalTokenGuard(verifier, new Reflector()));
    app.useGlobalFilters(new ProblemFilter());
    await app.init();
    token = await signer.sign('notification-service', {
      actor: { type: 'system', id: 'api-gateway' },
      organizationId: null,
    });
  });

  beforeEach(() => {
    submit.mockReset().mockResolvedValue('accepted');
    subscribe.mockReset().mockResolvedValue('accepted');
  });

  afterAll(async () => app.close());

  it('accepts the signed contact request once with an empty private receipt', async () => {
    const key = randomUUID();
    const response = await request(app.getHttpServer() as Server)
      .post(contactPath)
      .set('Authorization', `Bearer ${token}`)
      .set('Idempotency-Key', key)
      .send(body)
      .expect(202);
    expect(response.text).toBe('');
    expect(response.headers['cache-control']).toBe('private, no-store');
    expect(submit).toHaveBeenCalledExactlyOnceWith({ ...body, idempotencyKey: key });
  });

  it('accepts a newsletter address and returns an empty receipt', async () => {
    const response = await request(app.getHttpServer() as Server)
      .post(newsletterPath)
      .set('Authorization', `Bearer ${token}`)
      .send({ email: body.email })
      .expect(202);
    expect(response.text).toBe('');
    expect(response.headers['cache-control']).toBe('private, no-store');
    expect(subscribe).toHaveBeenCalledExactlyOnceWith({ email: body.email });
  });

  it.each([
    ['in-progress', 409, 'idempotency.request-in-progress'],
    ['key-reused', 422, 'idempotency.key-reused'],
  ] as const)('maps %s without exposing the payload', async (result, status, code) => {
    submit.mockResolvedValue(result);
    const response = await request(app.getHttpServer() as Server)
      .post(contactPath)
      .set('Authorization', `Bearer ${token}`)
      .set('Idempotency-Key', randomUUID())
      .send(body)
      .expect(status);
    expect(response.body).toMatchObject({ code });
    expect(response.headers['cache-control']).toBe('private, no-store');
    expect(JSON.stringify(response.body)).not.toContain(body.email);
    expect(JSON.stringify(response.body)).not.toContain(body.message);
  });

  it('rejects missing credentials, a wrong system actor and organization-scoped tokens', async () => {
    const missing = await request(app.getHttpServer() as Server)
      .post(newsletterPath)
      .send({ email: body.email })
      .expect(401);
    expect(missing.headers['cache-control']).toBe('private, no-store');
    for (const actor of [
      { type: 'system' as const, id: 'other-service' },
      { type: 'user' as const, id: '01938f6e-8a42-7d5b-b2c9-5e1f3a6d9c24' },
    ]) {
      const bad = await signer.sign('notification-service', { actor, organizationId: null });
      await request(app.getHttpServer() as Server)
        .post(newsletterPath)
        .set('Authorization', `Bearer ${bad}`)
        .send({ email: body.email })
        .expect(403);
    }
    const scoped = await signer.sign('notification-service', {
      actor: { type: 'system', id: 'api-gateway' },
      organizationId: '01938f6e-6d1a-7c3e-9a51-2f0c4b8d7e10',
    });
    await request(app.getHttpServer() as Server)
      .post(newsletterPath)
      .set('Authorization', `Bearer ${scoped}`)
      .send({ email: body.email })
      .expect(403);
    expect(subscribe).not.toHaveBeenCalled();
  });

  it('rejects malformed fields and unknown properties without returning values', async () => {
    const response = await request(app.getHttpServer() as Server)
      .post(contactPath)
      .set('Authorization', `Bearer ${token}`)
      .set('Idempotency-Key', randomUUID())
      .send({ ...body, extra: 'private value' })
      .expect(400);
    expect(response.body).toMatchObject({ code: 'request.invalid' });
    expect(JSON.stringify(response.body)).not.toContain('private value');
    await request(app.getHttpServer() as Server)
      .post(contactPath)
      .set('Authorization', `Bearer ${token}`)
      .send(body)
      .expect(400);
    await request(app.getHttpServer() as Server)
      .post(newsletterPath)
      .set('Authorization', `Bearer ${token}`)
      .send({ email: 'invalid' })
      .expect(400);
    expect(submit).not.toHaveBeenCalled();
    expect(subscribe).not.toHaveBeenCalled();
  });

  it('requires a JSON body and rejects query parameters', async () => {
    await request(app.getHttpServer() as Server)
      .post(newsletterPath)
      .set('Authorization', `Bearer ${token}`)
      .type('form')
      .send({ email: body.email })
      .expect(400);
    await request(app.getHttpServer() as Server)
      .post(`${newsletterPath}?extra=value`)
      .set('Authorization', `Bearer ${token}`)
      .send({ email: body.email })
      .expect(400);
    expect(subscribe).not.toHaveBeenCalled();
  });

  it('hides persistence failure details in a private unavailable response', async () => {
    submit.mockRejectedValue(new Error(`private ${body.message}`));
    const response = await request(app.getHttpServer() as Server)
      .post(contactPath)
      .set('Authorization', `Bearer ${token}`)
      .set('Idempotency-Key', randomUUID())
      .send(body)
      .expect(503);
    expect(response.body).toMatchObject({ code: 'upstream.unavailable' });
    expect(response.headers['cache-control']).toBe('private, no-store');
    expect(JSON.stringify(response.body)).not.toContain('private');
  });
});
