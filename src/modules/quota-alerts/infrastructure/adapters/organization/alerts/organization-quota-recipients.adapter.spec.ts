import { InternalTokenSigner, InternalTokenVerifier } from '@cadenway/nest-common';
import { beforeAll, describe, expect, it, vi } from 'vitest';

import { notificationIdentityTestKey } from '../../../../../../../tests/support/notification-identity-test-config.js';
import { createOrganizationQuotaRecipients } from './organization-quota-recipients.adapter.js';

const baseUrl = 'https://organization.example.test';
const organization = '019a7000-1a2b-7c3d-8e4f-5a6b7c8d9e12';
const recipient = '019a5f3c-8d2e-7c4a-9b1f-3e5d7a9c1b30';
const headers = { 'Cache-Control': 'private, no-store' };

describe('Organization quota authority', () => {
  let signer: InternalTokenSigner;
  let verifier: InternalTokenVerifier;

  beforeAll(async () => {
    const privateJwk = notificationIdentityTestKey();
    const { kty, crv, kid, x } = privateJwk;
    signer = await InternalTokenSigner.create({ issuer: 'notification-service', privateJwk });
    verifier = await InternalTokenVerifier.create({
      audience: 'organization-service',
      trustedIssuers: { 'notification-service': [{ kty, crv, kid, x }] },
    });
  });

  it('requests exactly one bounded page with a signed tenant and encodes the opaque cursor', async () => {
    const transport = vi
      .fn<typeof fetch>()
      .mockResolvedValue(Response.json({ items: [recipient], nextCursor: null }, { headers }));
    const adapter = createOrganizationQuotaRecipients({ baseUrl, signer, fetch: transport });
    await expect(
      adapter.list(organization, 'opaque+/=', new AbortController().signal),
    ).resolves.toEqual({
      items: [recipient],
      nextCursor: null,
    });
    const [call] = transport.mock.calls;
    const [url, init] = call ?? [];
    if (!(url instanceof URL)) throw new Error('Expected the resolved Organization URL.');
    expect(url.pathname).toBe('/internal/v1/quota-notification-recipients');
    expect(Object.fromEntries(url.searchParams)).toEqual({ limit: '100', cursor: 'opaque+/=' });
    expect(init).toMatchObject({ method: 'GET', cache: 'no-store', redirect: 'error' });
    const token = new Headers(init?.headers).get('Authorization')?.replace(/^Bearer /u, '');
    if (token === undefined) throw new Error('Expected a signed Organization authorization.');
    await expect(verifier.verify(token)).resolves.toMatchObject({
      issuer: 'notification-service',
      organizationId: organization,
      actor: { type: 'system', id: 'notification-service' },
      role: null,
      scopes: [],
    });
  });

  it('defers on 503 and makes a new private lookup when the job retries', async () => {
    const transport = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        Response.json(
          { type: 'about:blank', title: 'Unavailable', status: 503, detail: 'private fixture' },
          { status: 503, headers: { ...headers, 'Content-Type': 'application/problem+json' } },
        ),
      )
      .mockResolvedValueOnce(Response.json({ items: [] }, { headers }));
    const adapter = createOrganizationQuotaRecipients({ baseUrl, signer, fetch: transport });
    const signal = new AbortController().signal;
    await expect(adapter.isEligible(organization, recipient, signal)).rejects.toThrow(
      'Organization could not supply the current quota notification authority.',
    );
    expect(transport).toHaveBeenCalledTimes(1);
    await expect(adapter.isEligible(organization, recipient, signal)).resolves.toBe(false);
    expect(transport).toHaveBeenCalledTimes(2);
  });
});
