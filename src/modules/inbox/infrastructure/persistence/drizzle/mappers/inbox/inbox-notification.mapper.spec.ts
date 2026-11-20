import { describe, expect, it } from 'vitest';

import type { inboxNotifications } from '../../schemas/inbox/inbox-notifications.schema.js';
import { toInboxNotification } from './inbox-notification.mapper.js';

const createdAt = new Date('2026-11-08T08:00:00.000Z');
const row: typeof inboxNotifications.$inferSelect = {
  id: '019a7000-1a2b-7c3d-8e4f-5a6b7c8d9e01',
  organizationId: '019a7000-1a2b-7c3d-8e4f-5a6b7c8d9e02',
  recipientId: '019a7000-1a2b-7c3d-8e4f-5a6b7c8d9e03',
  sourceEventId: '019a7000-1a2b-7c3d-8e4f-5a6b7c8d9e04',
  kind: 'mention',
  actorUserId: null,
  subjectKind: 'task-id',
  subjectValue: '019a7000-1a2b-7c3d-8e4f-5a6b7c8d9e05',
  commentId: null,
  status: null,
  creationGeneration: 1n,
  createdAt,
  updatedAt: createdAt,
  readAt: null,
  archivedAt: null,
  version: 1,
};

describe('inbox persistence mapper', () => {
  it('restores scoped state and timestamps', () => {
    expect(toInboxNotification(row).snapshot).toEqual({
      id: row.id,
      organizationId: row.organizationId,
      recipientId: row.recipientId,
      kind: row.kind,
      actorUserId: null,
      subject: { kind: 'task', id: row.subjectValue },
      createdAt: createdAt.getTime(),
      readAt: null,
      archivedAt: null,
      version: 1,
    });
  });

  it('rejects incomplete or unknown persisted subjects', () => {
    expect(() => toInboxNotification({ ...row, subjectKind: null })).toThrow();
    expect(() => toInboxNotification({ ...row, subjectValue: null })).toThrow();
    expect(() => toInboxNotification({ ...row, subjectKind: 'unknown' })).toThrow();
  });

  it('restores a task key without changing its selector value', () => {
    const notice = toInboxNotification({
      ...row,
      subjectKind: 'task-key',
      subjectValue: 'CAD-482',
    });
    expect(notice.snapshot.subject).toEqual({ kind: 'task', id: 'CAD-482' });
  });
});
