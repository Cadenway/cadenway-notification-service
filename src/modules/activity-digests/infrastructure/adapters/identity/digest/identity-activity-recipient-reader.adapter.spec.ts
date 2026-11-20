import {
  InternalTokenSigner,
  InternalTokenVerifier,
  runWithOrganizationContext,
} from '@cadenway/nest-common';
import { beforeAll, describe, expect, it, vi } from 'vitest';

import { notificationIdentityTestKey } from '../../../../../../../tests/support/notification-identity-test-config.js';
import { createActivityRecipientReader } from './identity-activity-recipient-reader.adapter.js';

const baseUrl = 'http://identity.test';
const userId = '019a5f3c-8d2e-7c4a-9b1f-3e5d7a9c1b30';
const recipient = {
  email: 'recipient@example.test',
  language: 'fr',
  timeZone: 'Europe/Paris',
  version: 3,
};

/** Makes a sanitized Identity problem fixture with the contract's cache and media type. */
function problem(status: number, code: string, cacheControl = 'no-store'): Response {
  return Response.json(
    { type: 'about:blank', title: 'Synthetic failure', status, code, detail: recipient.email },
    {
      status,
      headers: { 'Content-Type': 'application/problem+json', 'Cache-Control': cacheControl },
    },
  );
}

describe('Identity activity recipient reader', () => {
  let signer: InternalTokenSigner;
  let verifier: InternalTokenVerifier;

  beforeAll(async () => {
    const privateJwk = notificationIdentityTestKey();
    const { kty, crv, kid, x } = privateJwk;
    signer = await InternalTokenSigner.create({ issuer: 'notification-service', privateJwk });
    verifier = await InternalTokenVerifier.create({
      audience: 'identity-service',
      trustedIssuers: { 'notification-service': [{ kty, crv, kid, x }] },
    });
  });

  it('reads each current profile with the signed global actor even inside a tenant', async () => {
    const responseHeaders = { 'Cache-Control': 'no-store' };
    const updated = { ...recipient, email: 'new@example.test', version: 4 };
    const transport = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(Response.json(recipient, { headers: responseHeaders }))
      .mockResolvedValueOnce(Response.json(updated, { headers: responseHeaders }));
    const reader = createActivityRecipientReader({ baseUrl, signer, fetch: transport });

    await expect(
      runWithOrganizationContext(
        {
          organizationId: '019a7000-1a2b-7c3d-8e4f-5a6b7c8d9e12',
          actor: { type: 'user', id: '019a5f3c-8d2e-7c4a-9b1f-3e5d7a9c1b31' },
          role: 'owner',
          scopes: ['tasks:read'],
        },
        () => reader.findCurrent(userId),
      ),
    ).resolves.toEqual({ ...recipient, userId });
    await expect(reader.findCurrent(userId)).resolves.toEqual({ ...updated, userId });
    expect(transport).toHaveBeenCalledTimes(2);

    for (const [url, init] of transport.mock.calls) {
      if (!(url instanceof URL)) throw new Error('Expected a resolved Identity URL.');
      expect(url.href).toBe(`${baseUrl}/internal/v1/users/${userId}/notification-recipient`);
      expect(init).toMatchObject({ method: 'GET', cache: 'no-store', redirect: 'error' });
      expect(init?.body).toBeUndefined();
      const token = new Headers(init?.headers).get('Authorization')?.replace(/^Bearer /u, '');
      if (token === undefined) throw new Error('Expected a signed authorization header.');
      await expect(verifier.verify(token)).resolves.toMatchObject({
        issuer: 'notification-service',
        audience: 'identity-service',
        organizationId: null,
        actor: { type: 'system', id: null },
        role: null,
        scopes: [],
      });
    }
  });

  it('returns null only for the private user-not-found problem', async () => {
    const transport = vi.fn<typeof fetch>().mockResolvedValue(problem(404, 'user.not-found'));
    const reader = createActivityRecipientReader({ baseUrl, signer, fetch: transport });
    await expect(reader.findCurrent(userId)).resolves.toBeNull();
    expect(transport).toHaveBeenCalledOnce();
  });

  it.each([
    ['unmarked profile', () => Response.json(recipient)],
    ['different 404', () => problem(404, 'other.not-found')],
    ['cacheable 404', () => problem(404, 'user.not-found', 'public')],
    ['refused issuer', () => problem(403, 'auth.issuer-not-allowed')],
    ['unavailable', () => problem(503, 'upstream.unavailable')],
    [
      'malformed JSON',
      () =>
        new Response(`{ ${recipient.email}`, {
          headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
        }),
    ],
    [
      'unexpected fields',
      () =>
        Response.json(
          { ...recipient, unauthorizedField: true },
          { headers: { 'Cache-Control': 'no-store' } },
        ),
    ],
    [
      'oversized body',
      () =>
        Response.json(
          { ...recipient, language: 'a'.repeat(4_096) },
          { headers: { 'Cache-Control': 'no-store' } },
        ),
    ],
  ] as const)('fails a job once without sensitive diagnostics on %s', async (_label, response) => {
    const transport = vi.fn<typeof fetch>().mockResolvedValue(response());
    const reader = createActivityRecipientReader({ baseUrl, signer, fetch: transport });
    const failure = await reader.findCurrent(userId).catch((error: unknown) => error);
    expect(failure).toBeInstanceOf(Error);
    expect(failure).toMatchObject({
      message: 'Identity could not supply the current activity email recipient.',
    });
    expect(failure).not.toHaveProperty('cause');
    expect(transport).toHaveBeenCalledOnce();
  });

  it('ends a stalled body within the lookup deadline and releases the stream', async () => {
    const cancel = vi.fn();
    const stream = new ReadableStream<Uint8Array>({ cancel });
    const transport = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(stream, {
        headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
      }),
    );
    const reader = createActivityRecipientReader({ baseUrl, signer, fetch: transport });
    await expect(reader.findCurrent(userId)).rejects.toThrow('could not supply');
    expect(cancel).toHaveBeenCalledOnce();
    expect(stream.locked).toBe(false);
  });

  it('does not pass a malformed account identifier to HTTP', async () => {
    const transport = vi.fn<typeof fetch>();
    const reader = createActivityRecipientReader({ baseUrl, signer, fetch: transport });
    await expect(reader.findCurrent('../accounts')).rejects.toThrow('could not supply');
    expect(transport).not.toHaveBeenCalled();
  });
});
