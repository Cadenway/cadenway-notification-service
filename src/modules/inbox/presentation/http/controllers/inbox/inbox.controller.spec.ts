import 'reflect-metadata';

import { generateKeyPairSync } from 'node:crypto';
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
import { PlatformModule } from '../../../../../platform/platform.module.js';

import { InboxGenerationChanged } from '../../../../application/models/inbox/inbox-generation-changed.model.js';
import { ArchiveCheckedNotification } from '../../../../application/use-cases/commands/inbox/archive-checked-notification/archive-checked-notification.use-case.js';
import { ReadCheckedNotification } from '../../../../application/use-cases/commands/inbox/read-checked-notification/read-checked-notification.use-case.js';
import { ReadSelectedNotifications } from '../../../../application/use-cases/commands/inbox/read-selected-notifications/read-selected-notifications.use-case.js';
import { GetInboxCandidate } from '../../../../application/use-cases/queries/inbox/get-inbox-candidate/get-inbox-candidate.use-case.js';
import { ListInboxCandidates } from '../../../../application/use-cases/queries/inbox/list-inbox-candidates/list-inbox-candidates.use-case.js';
import { ListUnreadSubjects } from '../../../../application/use-cases/queries/inbox/list-unread-subjects/list-unread-subjects.use-case.js';
import { InboxController } from './inbox.controller.js';

const user = '019a7000-1a2b-7c3d-8e4f-5a6b7c8d9e02';
const organization = '019a7000-1a2b-7c3d-8e4f-5a6b7c8d9e03';
const id = '019a7000-1a2b-7c3d-8e4f-5a6b7c8d9e11';
const path = '/internal/v1/inbox';
const record = {
  id,
  kind: 'mention',
  actorUserId: null,
  subject: { kind: 'task-key', taskKey: 'CAD-482' },
  createdAt: '2026-11-08T08:48:00.000Z',
  readAt: null,
  archivedAt: null,
  version: 1,
} as const;

describe('InboxController', () => {
  let app: INestApplication;
  let token: string;
  let otherToken: string;
  const list = vi.fn();
  const get = vi.fn();
  const unread = vi.fn();
  const read = vi.fn();
  const archive = vi.fn();
  const readSelected = vi.fn();

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
    const signer = await InternalTokenSigner.create({
      issuer: 'api-gateway',
      privateJwk: privateKey,
    });
    const other = await InternalTokenSigner.create({
      issuer: 'other-service',
      privateJwk: privateKey,
    });
    token = await signer.sign('notification-service', {
      actor: { type: 'user', id: user },
      organizationId: organization,
    });
    otherToken = await other.sign('notification-service', {
      actor: { type: 'user', id: user },
      organizationId: organization,
    });
    const verifier = await InternalTokenVerifier.create({
      audience: 'notification-service',
      trustedIssuers: { 'api-gateway': [publicKey], 'other-service': [publicKey] },
    });
    const module = await Test.createTestingModule({
      imports: [PlatformModule],
      controllers: [InboxController],
      providers: [
        { provide: ListInboxCandidates, useValue: { execute: list } },
        { provide: GetInboxCandidate, useValue: { execute: get } },
        { provide: ListUnreadSubjects, useValue: { execute: unread } },
        { provide: ReadCheckedNotification, useValue: { execute: read } },
        { provide: ArchiveCheckedNotification, useValue: { execute: archive } },
        { provide: ReadSelectedNotifications, useValue: { execute: readSelected } },
      ],
    }).compile();
    app = module.createNestApplication();
    app.useGlobalGuards(new InternalTokenGuard(verifier, new Reflector()));
    app.useGlobalFilters(new ProblemFilter());
    await app.init();
  });

  beforeEach(() => {
    for (const mock of [list, get, unread, read, archive, readSelected]) mock.mockReset();
  });

  afterAll(async () => app.close());

  it('returns owner-state unavailability when a database connection closes', async () => {
    get.mockRejectedValueOnce(Object.assign(new Error('private connection'), { code: '08006' }));
    const response = await request(app.getHttpServer() as Server)
      .get(`${path}/notifications/${id}`)
      .set('Authorization', `Bearer ${token}`)
      .expect(503);
    expect(response.body as unknown).toMatchObject({ code: 'upstream.unavailable' });
    expect(JSON.stringify(response.body)).not.toContain('private');
  });

  it('requires a gateway token before reading a candidate', async () => {
    await request(app.getHttpServer() as Server)
      .get(`${path}/notifications/${id}`)
      .expect(401);
    await request(app.getHttpServer() as Server)
      .get(`${path}/notifications/${id}`)
      .set('Authorization', `Bearer ${otherToken}`)
      .expect(403);
    expect(get).not.toHaveBeenCalled();
  });

  it('binds continuation cursors to the verified owner and filter', async () => {
    const position = { createdAt: new Date(record.createdAt), id };
    list.mockResolvedValue({ items: [{ record, cursorAfter: position }], next: position });
    const first = await request(app.getHttpServer() as Server)
      .get(`${path}/notifications?state=unread&limit=1`)
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
    const cursor = (first.body as { nextCursor: string }).nextCursor;
    await request(app.getHttpServer() as Server)
      .get(`${path}/notifications`)
      .query({ state: 'unread', cursor })
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
    expect(list).toHaveBeenLastCalledWith({
      organizationId: organization,
      recipientId: user,
      state: 'unread',
      limit: 50,
      after: position,
    });
    await request(app.getHttpServer() as Server)
      .get(`${path}/notifications`)
      .query({ state: 'active', cursor })
      .set('Authorization', `Bearer ${token}`)
      .expect(400);
  });

  it('binds unread pagination to the first generation and maps conflicts', async () => {
    unread.mockResolvedValueOnce({
      generation: '18',
      items: [],
      next: { kind: 'task-key', value: 'CAD-482' },
    });
    const first = await request(app.getHttpServer() as Server)
      .get(`${path}/unread-subjects`)
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
    unread.mockRejectedValueOnce(new InboxGenerationChanged());
    const response = await request(app.getHttpServer() as Server)
      .get(`${path}/unread-subjects`)
      .query({ cursor: (first.body as { nextCursor: string }).nextCursor })
      .set('Authorization', `Bearer ${token}`)
      .expect(409);
    expect(response.body).toMatchObject({ code: 'notification.inbox-generation-changed' });
    expect(unread).toHaveBeenLastCalledWith({
      organizationId: organization,
      recipientId: user,
      expectedGeneration: '18',
      after: { kind: 'task-key', value: 'CAD-482' },
      limit: 50,
    });
  });

  it('passes checked linkage and strong validators and masks absent records', async () => {
    read
      .mockResolvedValueOnce({ kind: 'not-found' })
      .mockResolvedValueOnce({ kind: 'version-mismatch', currentVersion: 3 })
      .mockResolvedValueOnce({ kind: 'ok', record });
    const call = () =>
      request(app.getHttpServer() as Server)
        .post(`${path}/notifications/${id}/read`)
        .set('Authorization', `Bearer ${token}`)
        .set('If-Match', '"1", "2"')
        .send({ subject: record.subject });
    await call().expect(404);
    const conflict = await call().expect(412);
    expect(conflict.headers.etag).toBe('"3"');
    const success = await call().expect(200);
    expect(success.headers.etag).toBe('"1"');
    expect(read).toHaveBeenLastCalledWith({
      organizationId: organization,
      recipientId: user,
      notificationId: id,
      subject: record.subject,
      expectedVersions: [1, 2],
    });
  });

  it('validates generation bounds and maps a read-all conflict', async () => {
    const call = (snapshotGeneration: string, creationCutoff: string) =>
      request(app.getHttpServer() as Server)
        .post(`${path}/notifications/read-all`)
        .set('Authorization', `Bearer ${token}`)
        .send({ snapshotGeneration, creationCutoff, authorizedSubjects: [] });
    await call('9223372036854775808', '1').expect(400);
    await call('1', '2').expect(400);
    expect(readSelected).not.toHaveBeenCalled();
    readSelected.mockRejectedValue(new InboxGenerationChanged());
    const response = await call('2', '1').expect(409);
    expect(response.body).toMatchObject({ code: 'notification.inbox-generation-changed' });
  });

  it('archives the exact owner-only binding and preserves the returned version', async () => {
    archive.mockResolvedValue({ kind: 'ok', record: { ...record, subject: null, version: 2 } });
    const response = await request(app.getHttpServer() as Server)
      .post(`${path}/notifications/${id}/archive`)
      .set('Authorization', `Bearer ${token}`)
      .set('If-Match', '*')
      .send({ subject: null })
      .expect(200);
    expect(response.headers.etag).toBe('"2"');
    expect(response.body).toMatchObject({ id, subject: null, version: 2 });
    expect(archive).toHaveBeenCalledExactlyOnceWith({
      organizationId: organization,
      recipientId: user,
      notificationId: id,
      subject: null,
      expectedVersions: '*',
    });
  });
});
