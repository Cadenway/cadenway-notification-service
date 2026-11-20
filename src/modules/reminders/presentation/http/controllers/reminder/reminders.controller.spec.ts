import 'reflect-metadata';

import { ListRemindersInternalResponse } from '@cadenway/contracts/validators/internal/notification-service';
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
import type { INestApplication } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { PlatformModule } from '../../../../../platform/platform.module.js';

import { CompleteReminder } from '../../../../application/use-cases/commands/reminder/complete-reminder/complete-reminder.use-case.js';
import { DeleteReminder } from '../../../../application/use-cases/commands/reminder/delete-reminder/delete-reminder.use-case.js';
import { SetTaskReminder } from '../../../../application/use-cases/commands/reminder/set-task-reminder/set-task-reminder.use-case.js';
import { SnoozeReminder } from '../../../../application/use-cases/commands/reminder/snooze-reminder/snooze-reminder.use-case.js';
import { UpdateReminderNote } from '../../../../application/use-cases/commands/reminder/update-reminder-note/update-reminder-note.use-case.js';
import { GetReminder } from '../../../../application/use-cases/queries/reminder/get-reminder/get-reminder.use-case.js';
import { GetReminderCandidate } from '../../../../application/use-cases/queries/reminder/get-reminder-candidate/get-reminder-candidate.use-case.js';
import { GetTaskReminder } from '../../../../application/use-cases/queries/reminder/get-task-reminder/get-task-reminder.use-case.js';
import { ListReminderCandidates } from '../../../../application/use-cases/queries/reminder/list-reminder-candidates/list-reminder-candidates.use-case.js';
import { ListSelectedReminders } from '../../../../application/use-cases/queries/reminder/list-selected-reminders/list-selected-reminders.use-case.js';
import { ReminderGenerationChanged } from '../../../../application/models/reminder/reminder-generation-changed.model.js';
import { ReminderVersionMismatch } from '../../../../application/models/reminder/reminder-access.model.js';
import { RemindersController } from './reminders.controller.js';

const user = '01938f6e-8a42-7d5b-b2c9-5e1f3a6d9c24';
const organization = '01938f6e-6d1a-7c3e-9a51-2f0c4b8d7e10';
const task = '019a7002-3c4d-7e5f-8a6b-7c8d9e0f1a23';
const id = '019a7000-1a2b-7c3d-8e4f-5a6b7c8d9e12';
const snapshot = {
  id,
  taskId: task,
  organizationId: organization,
  userId: user,
  remindAt: Date.parse('2026-11-08T14:00:00Z'),
  note: null,
  firedAt: null,
  completedAt: null,
  version: 2,
  createdAt: 0,
  scheduleVersion: 1,
};

describe('RemindersController', () => {
  let app: INestApplication;
  let token: string;
  let foreignToken: string;
  const list = vi.fn();
  const selected = vi.fn();
  const candidate = vi.fn();
  const get = vi.fn();
  const getTask = vi.fn();
  const set = vi.fn();
  const patch = vi.fn();
  const snooze = vi.fn();
  const complete = vi.fn();
  const remove = vi.fn();

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
    token = await signer.sign('notification-service', {
      actor: { type: 'user', id: user },
      organizationId: organization,
    });
    foreignToken = await signer.sign('notification-service', {
      actor: { type: 'user', id: user },
      organizationId: '01938f6e-6d1a-7c3e-9a51-2f0c4b8d7e11',
    });
    const verifier = await InternalTokenVerifier.create({
      audience: 'notification-service',
      trustedIssuers: { 'api-gateway': [publicKey] },
    });
    const module = await Test.createTestingModule({
      imports: [PlatformModule],
      controllers: [RemindersController],
      providers: [
        { provide: ListReminderCandidates, useValue: { execute: list } },
        { provide: ListSelectedReminders, useValue: { execute: selected } },
        { provide: GetReminderCandidate, useValue: { execute: candidate } },
        { provide: GetReminder, useValue: { execute: get } },
        { provide: GetTaskReminder, useValue: { execute: getTask } },
        { provide: SetTaskReminder, useValue: { execute: set } },
        { provide: UpdateReminderNote, useValue: { execute: patch } },
        { provide: SnoozeReminder, useValue: { execute: snooze } },
        { provide: CompleteReminder, useValue: { execute: complete } },
        { provide: DeleteReminder, useValue: { execute: remove } },
      ],
    }).compile();
    app = module.createNestApplication();
    app.useGlobalGuards(new InternalTokenGuard(verifier, new Reflector()));
    app.useGlobalInterceptors(new EtagInterceptor());
    app.useGlobalFilters(new ProblemFilter());
    await app.init();
  });
  beforeEach(() => {
    vi.clearAllMocks();
    get.mockResolvedValue(snapshot);
  });
  afterAll(async () => app.close());

  it('returns owner-state unavailability on PostgreSQL shutdown', async () => {
    list.mockRejectedValueOnce(Object.assign(new Error('private query'), { code: '57P01' }));
    const response = await request(app.getHttpServer() as Server)
      .get('/internal/v1/reminders')
      .set('Authorization', `Bearer ${token}`)
      .expect(503);
    expect(response.body as unknown).toMatchObject({ code: 'upstream.unavailable' });
    expect(JSON.stringify(response.body)).not.toContain('private');
  });

  it('binds each continuation to the tenant, recipient and sampled generation', async () => {
    list.mockResolvedValue({
      generation: '4',
      hasMore: true,
      items: [{ id, taskId: task, remindAt: snapshot.remindAt }],
    });
    const first = await request(app.getHttpServer() as Server)
      .get('/internal/v1/reminders')
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
    const page = ListRemindersInternalResponse.parse(first.body as unknown);
    expect(page.items[0]?.remindAt).toBe('2026-11-08T14:00:00.000Z');
    await request(app.getHttpServer() as Server)
      .get('/internal/v1/reminders')
      .query({ cursor: page.nextCursor })
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
    expect(list).toHaveBeenLastCalledWith({
      organizationId: organization,
      userId: user,
      expectedGeneration: '4',
      after: { id, remindAt: snapshot.remindAt },
      limit: 50,
    });
    await request(app.getHttpServer() as Server)
      .get('/internal/v1/reminders')
      .query({ cursor: page.nextCursor })
      .set('Authorization', `Bearer ${foreignToken}`)
      .expect(400);
  });

  it('checks generation even for an empty selection', async () => {
    selected.mockRejectedValue(new ReminderGenerationChanged());
    const response = await request(app.getHttpServer() as Server)
      .post('/internal/v1/reminders/visible')
      .set('Authorization', `Bearer ${token}`)
      .send({ snapshotGeneration: '4', items: [] })
      .expect(409);
    expect(response.body as unknown).toMatchObject({ code: 'reminder.generation-changed' });
    expect(selected).toHaveBeenCalledWith({
      organizationId: organization,
      userId: user,
      expectedGeneration: '4',
      pairs: [],
    });
  });

  it('returns only the private representation and ignores conditional reads', async () => {
    for (const tag of ['"2"', '*']) {
      const response = await request(app.getHttpServer() as Server)
        .get(`/internal/v1/reminders/${id}`)
        .query({ authorizedTaskId: task })
        .set('Authorization', `Bearer ${token}`)
        .set('If-None-Match', tag)
        .expect(200);
      expect(response.headers.etag).toBe('"2"');
      expect(response.body).not.toHaveProperty('userId');
      expect(response.body).not.toHaveProperty('organizationId');
    }
  });

  it('forwards strong validator lists and returns the current ETag on a mismatch', async () => {
    patch.mockRejectedValue(new ReminderVersionMismatch(2));
    const response = await request(app.getHttpServer() as Server)
      .patch(`/internal/v1/reminders/${id}`)
      .query({ authorizedTaskId: task })
      .set('Authorization', `Bearer ${token}`)
      .set('If-Match', '"1", "3"')
      .send({ note: null })
      .expect(412);
    expect(response.headers.etag).toBe('"2"');
    expect(response.body as unknown).toMatchObject({ code: 'request.version-mismatch' });
    expect(patch).toHaveBeenCalledWith({
      organizationId: organization,
      userId: user,
      id,
      authorizedTaskId: task,
      note: null,
      expectedVersions: [1, 3],
    });
  });

  it('returns 201 and Location only when a task reminder occupies a new slot', async () => {
    set.mockResolvedValue({ reminder: snapshot, created: true });
    const created = await request(app.getHttpServer() as Server)
      .put(`/internal/v1/tasks/${task}/reminder`)
      .set('Authorization', `Bearer ${token}`)
      .send({ remindAt: '2026-11-08T14:00:00Z' })
      .expect(201);
    expect(created.headers.location).toBe(`/internal/v1/reminders/${id}`);
    expect(created.headers.etag).toBe('"2"');
    expect(set).toHaveBeenCalledWith(
      expect.objectContaining({
        organizationId: organization,
        userId: user,
        taskId: task,
        note: null,
      }),
    );
    set.mockResolvedValue({ reminder: snapshot, created: false });
    await request(app.getHttpServer() as Server)
      .put(`/internal/v1/tasks/${task}/reminder`)
      .set('Authorization', `Bearer ${token}`)
      .set('If-Match', '*')
      .send({ remindAt: '2026-11-08T14:00:00Z' })
      .expect(200);
    expect(set).toHaveBeenLastCalledWith(expect.objectContaining({ expectedVersions: '*' }));
  });

  it('refuses missing identity and invalid UUIDs before reading reminders', async () => {
    await request(app.getHttpServer() as Server)
      .get('/internal/v1/reminders')
      .expect(401);
    await request(app.getHttpServer() as Server)
      .get('/internal/v1/reminders/invalid/candidate')
      .set('Authorization', `Bearer ${token}`)
      .expect(400);
    expect(candidate).not.toHaveBeenCalled();
  });

  it('completes and deletes only with the task binding supplied by the gateway', async () => {
    complete.mockResolvedValue(snapshot);
    remove.mockResolvedValue(undefined);
    await request(app.getHttpServer() as Server)
      .post(`/internal/v1/reminders/${id}/complete`)
      .query({ authorizedTaskId: task })
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
    expect(complete).toHaveBeenCalledWith(
      expect.objectContaining({
        organizationId: organization,
        userId: user,
        id,
        authorizedTaskId: task,
      }),
    );
    await request(app.getHttpServer() as Server)
      .delete(`/internal/v1/reminders/${id}`)
      .query({ authorizedTaskId: task })
      .set('Authorization', `Bearer ${token}`)
      .expect(204);
    expect(remove).toHaveBeenCalledWith({
      organizationId: organization,
      userId: user,
      id,
      authorizedTaskId: task,
    });
    await request(app.getHttpServer() as Server)
      .delete(`/internal/v1/reminders/${id}`)
      .set('Authorization', `Bearer ${token}`)
      .expect(400);
  });
});
