import { describe, expect, it } from 'vitest';

import { InboxError } from '../../errors/inbox/inbox.error.js';
import { InboxNotification } from './inbox-notification.aggregate.js';

const createdAt = Date.parse('2026-11-08T08:00:00Z');
const readAt = Date.parse('2026-11-08T09:00:00Z');
const archivedAt = Date.parse('2026-11-08T10:00:00Z');
const notice = {
  id: '019a7000-1a2b-7c3d-8e4f-5a6b7c8d9e01',
  organizationId: '019a7000-1a2b-7c3d-8e4f-5a6b7c8d9e02',
  recipientId: '019a7000-1a2b-7c3d-8e4f-5a6b7c8d9e03',
  kind: 'mention',
  actorUserId: '019a7000-1a2b-7c3d-8e4f-5a6b7c8d9e04',
  subject: { kind: 'task', id: '019a7000-1a2b-7c3d-8e4f-5a6b7c8d9e05' } as const,
  createdAt,
};

describe('InboxNotification', () => {
  it('creates an unread active record and a fact addressed only to its recipient', () => {
    const { notification, fact } = InboxNotification.create(notice);

    expect(notification.snapshot).toEqual({
      ...notice,
      readAt: null,
      archivedAt: null,
      version: 1,
    });
    expect(notification.isUnread).toBe(true);
    expect(fact).toEqual({
      notificationId: notice.id,
      organizationId: notice.organizationId,
      recipientId: notice.recipientId,
      createdAt,
    });
  });

  it('keeps the first read instant and version on replay', () => {
    const original = InboxNotification.create(notice).notification;
    const read = original.markRead(readAt);

    expect(read.snapshot).toMatchObject({ readAt, archivedAt: null, version: 2 });
    expect(read.isUnread).toBe(false);
    expect(read.markRead(archivedAt)).toBe(read);
    expect(original.snapshot.readAt).toBeNull();
  });

  it('archives without marking read and excludes archived notices from the badge', () => {
    const original = InboxNotification.create(notice).notification;
    const archived = original.archive(archivedAt);

    expect(archived.snapshot).toMatchObject({ archivedAt, readAt: null, version: 2 });
    expect(archived.isUnread).toBe(false);
    expect(archived.archive(archivedAt + 1)).toBe(archived);
  });

  it('uses the same not-found refusal after a visibility or ownership failure', () => {
    const { notification } = InboxNotification.create(notice);

    expect(() => {
      notification.requireAccess(notice.organizationId, notice.recipientId, true);
    }).not.toThrow();
    for (const [org, recipient, visible] of [
      ['another organization', notice.recipientId, true],
      [notice.organizationId, notice.actorUserId, true],
      [notice.organizationId, notice.recipientId, false],
    ] as const) {
      expect(() => {
        notification.requireAccess(org, recipient, visible);
      }).toThrow(InboxError);
      expect(() => {
        notification.requireAccess(org, recipient, visible);
      }).toThrow(expect.objectContaining({ code: 'notification.not-found' }));
    }
  });

  it('refuses invalid chronological state on restore and mutation', () => {
    const { notification } = InboxNotification.create(notice);

    expect(() => notification.archive(createdAt - 1)).toThrow(InboxError);
    expect(() => notification.markRead(Number.NaN)).toThrow(InboxError);
    expect(() =>
      InboxNotification.restore({ ...notification.snapshot, readAt: createdAt - 1 }),
    ).toThrow(InboxError);
  });
});
