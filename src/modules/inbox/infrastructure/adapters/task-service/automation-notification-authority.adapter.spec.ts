import { InternalTokenSigner, InternalTokenVerifier, runWithDeadline } from '@cadenway/nest-common';
import { beforeAll, describe, expect, it, vi } from 'vitest';

import { notificationIdentityTestKey } from '../../../../../../tests/support/notification-identity-test-config.js';
import { createTaskAutomationNotificationAuthority } from './automation-notification-authority.adapter.js';

const baseUrl = 'https://task.example.test';
const command = {
  organizationId: '019a7000-1a2b-7c3d-8e4f-5a6b7c8d9e12',
  taskKey: 'CAD-482',
  ruleAuthorUserId: '019a5f3c-8d2e-7c4a-9b1f-3e5d7a9c1b30',
  recipientUserId: '019a5f3c-9e1f-7b2a-8c3d-4e5f6a7b8c31',
};
const cache = { 'Cache-Control': 'private, no-store' };
const problemHeaders = { ...cache, 'Content-Type': 'application/problem+json' };
const denial = { type: 'about:blank', title: 'Not Found', status: 404, code: 'task.not-found' };

describe('Task automation notification authority', () => {
  let signer: InternalTokenSigner;
  let verifier: InternalTokenVerifier;

  beforeAll(async () => {
    const privateJwk = notificationIdentityTestKey();
    const { kty, crv, kid, x } = privateJwk;
    signer = await InternalTokenSigner.create({ issuer: 'notification-service', privateJwk });
    verifier = await InternalTokenVerifier.create({
      audience: 'task-service',
      trustedIssuers: { 'notification-service': [{ kty, crv, kid, x }] },
    });
  });

  it('calls the private route with precisely the signed tenant and a bounded deadline', async () => {
    const transport = vi
      .fn<typeof fetch>()
      .mockResolvedValue(new Response(null, { status: 204, headers: cache }));
    const authority = createTaskAutomationNotificationAuthority({
      baseUrl,
      signer,
      fetch: transport,
    });

    await expect(runWithDeadline(1_000, () => authority.authorize(command))).resolves.toBe(
      'allowed',
    );
    expect(transport).toHaveBeenCalledTimes(1);
    const [url, init] = transport.mock.calls[0] ?? [];
    if (!(url instanceof URL)) throw new Error('Expected the resolved Task URL.');
    expect(url.href).toBe(
      `${baseUrl}/internal/v1/tasks/${command.taskKey}/automation-notification-authorization`,
    );
    expect(init).toMatchObject({
      method: 'POST',
      body: JSON.stringify({
        ruleAuthorUserId: command.ruleAuthorUserId,
        recipientUserId: command.recipientUserId,
      }),
      cache: 'no-store',
      redirect: 'error',
    });
    expect(init?.signal).toBeInstanceOf(AbortSignal);
    const headers = new Headers(init?.headers);
    expect(headers.get('Content-Type')).toBe('application/json');
    expect(Number(headers.get('X-Request-Timeout-Ms'))).toBeGreaterThan(0);
    expect(Number(headers.get('X-Request-Timeout-Ms'))).toBeLessThanOrEqual(1_000);
    const token = headers.get('Authorization')?.replace(/^Bearer /u, '');
    if (token === undefined) throw new Error('Expected a signed Task token.');
    await expect(verifier.verify(token)).resolves.toMatchObject({
      issuer: 'notification-service',
      organizationId: command.organizationId,
      actor: { type: 'system', id: 'notification-service' },
      role: null,
      scopes: [],
    });
  });

  it('requests current authority again and returns only the generic denial', async () => {
    const transport = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(new Response(null, { status: 204, headers: cache }))
      .mockResolvedValueOnce(
        Response.json(
          { ...denial, detail: 'private fixture', details: { userId: command.recipientUserId } },
          { status: 404, headers: problemHeaders },
        ),
      );
    const authority = createTaskAutomationNotificationAuthority({
      baseUrl,
      signer,
      fetch: transport,
    });
    await expect(authority.authorize(command)).resolves.toBe('allowed');
    await expect(authority.authorize(command)).resolves.toBe('denied');
    expect(transport).toHaveBeenCalledTimes(2);
  });

  it.each([
    ['a success without private caching', () => new Response(null, { status: 204 })],
    ['an unexpected success', () => Response.json({}, { status: 200, headers: cache })],
    ['a redirect', () => new Response(null, { status: 302, headers: cache })],
    ['a refused internal token', () => new Response(null, { status: 401, headers: cache })],
    ['an unavailable Task', () => new Response(null, { status: 503, headers: cache })],
    [
      'a denial without private caching',
      () =>
        Response.json(denial, {
          status: 404,
          headers: { 'Content-Type': 'application/problem+json' },
        }),
    ],
    [
      'a denial with the wrong media type',
      () => Response.json(denial, { status: 404, headers: cache }),
    ],
    [
      'a denial with the wrong code',
      () =>
        Response.json(
          { ...denial, code: 'http.not-found' },
          { status: 404, headers: problemHeaders },
        ),
    ],
    [
      'a denial with inconsistent status',
      () => Response.json({ ...denial, status: 403 }, { status: 404, headers: problemHeaders }),
    ],
    [
      'a truncated problem',
      () => new Response('{"code":"task.not-found"', { status: 404, headers: problemHeaders }),
    ],
    [
      'an incomplete problem',
      () => Response.json({ code: 'task.not-found' }, { status: 404, headers: problemHeaders }),
    ],
    [
      'an oversized problem',
      () =>
        Response.json(
          { ...denial, detail: 'x'.repeat(4_096) },
          { status: 404, headers: problemHeaders },
        ),
    ],
  ] as const)('fails closed without a retry after %s', async (_description, response) => {
    const transport = vi.fn<typeof fetch>().mockResolvedValue(response());
    const authority = createTaskAutomationNotificationAuthority({
      baseUrl,
      signer,
      fetch: transport,
    });
    await expect(authority.authorize(command)).resolves.toBe('unavailable');
    expect(transport).toHaveBeenCalledTimes(1);
  });

  it('does not make a call when configuration or generated request validation fails', async () => {
    const transport = vi.fn<typeof fetch>();
    await expect(
      createTaskAutomationNotificationAuthority({
        baseUrl: undefined,
        signer,
        fetch: transport,
      }).authorize(command),
    ).resolves.toBe('unavailable');
    await expect(
      createTaskAutomationNotificationAuthority({ baseUrl, signer, fetch: transport }).authorize({
        ...command,
        taskKey: '../../outside',
      }),
    ).resolves.toBe('unavailable');
    expect(transport).not.toHaveBeenCalled();
  });
});
