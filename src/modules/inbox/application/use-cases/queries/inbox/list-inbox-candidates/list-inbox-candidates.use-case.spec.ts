import { describe, expect, it, vi } from 'vitest';

import type { InboxCandidate } from '../../../../models/inbox/inbox-candidate.model.js';
import type { InboxCandidatesReader } from '../../../../ports/outbound/persistence/inbox/inbox-candidates-reader.port.js';
import { GetInboxCandidate } from '../get-inbox-candidate/get-inbox-candidate.use-case.js';
import { ListUnreadSubjects } from '../list-unread-subjects/list-unread-subjects.use-case.js';
import { ListInboxCandidates } from './list-inbox-candidates.use-case.js';

describe('private inbox reads', () => {
  const candidate: InboxCandidate = {
    id: '019a7000-1a2b-7c3d-8e4f-5a6b7c8d9e11',
    kind: 'mention',
    actorUserId: null,
    subject: { kind: 'task-key', taskKey: 'CAD-482' },
    createdAt: '2026-11-08T08:48:00.000Z',
    readAt: null,
    archivedAt: null,
    version: 1,
  };

  it('preserves the position after each candidate and only returns a continuation with lookahead', async () => {
    const position = { createdAt: new Date(candidate.createdAt), id: candidate.id };
    const pageCandidates = vi.fn().mockResolvedValue([
      { record: candidate, cursorAfter: position },
      { record: { ...candidate, id: 'next' }, cursorAfter: { ...position, id: 'next' } },
    ]);
    const reader: InboxCandidatesReader = {
      pageCandidates,
      findCandidate: vi.fn(),
      unreadSubjects: vi.fn(),
    };
    const list = new ListInboxCandidates(reader);
    const result = await list.execute({
      organizationId: 'org',
      recipientId: 'camille',
      state: 'unread',
      after: null,
      limit: 1,
    });
    expect(pageCandidates).toHaveBeenCalledWith('org', 'camille', 'unread', null, 2);
    expect(result).toEqual({
      items: [{ record: candidate, cursorAfter: position }],
      next: position,
    });
    pageCandidates.mockResolvedValueOnce([{ record: candidate, cursorAfter: position }]);
    await expect(
      list.execute({
        organizationId: 'org',
        recipientId: 'camille',
        state: 'active',
        after: null,
        limit: 100,
      }),
    ).resolves.toMatchObject({ next: null });
    expect(pageCandidates).toHaveBeenLastCalledWith('org', 'camille', 'active', null, 101);
  });

  it('returns only the exact linkage for a single candidate', async () => {
    const findCandidate = vi.fn().mockResolvedValue(candidate);
    const reader: InboxCandidatesReader = {
      pageCandidates: vi.fn(),
      findCandidate,
      unreadSubjects: vi.fn(),
    };
    const get = new GetInboxCandidate(reader);
    await expect(
      get.execute({ organizationId: 'org', recipientId: 'camille', notificationId: candidate.id }),
    ).resolves.toEqual({ id: candidate.id, subject: candidate.subject });
    expect(findCandidate).toHaveBeenCalledWith('org', 'camille', candidate.id);
  });

  it('preserves generation conflicts from a subject scan', async () => {
    const conflict = new Error('generation changed');
    const reader: InboxCandidatesReader = {
      pageCandidates: vi.fn(),
      findCandidate: vi.fn(),
      unreadSubjects: vi.fn().mockRejectedValue(conflict),
    };
    await expect(
      new ListUnreadSubjects(reader).execute({
        organizationId: 'org',
        recipientId: 'camille',
        expectedGeneration: '18',
        after: { kind: 'task-key', value: 'CAD-482' },
        limit: 20,
      }),
    ).rejects.toBe(conflict);
  });
});
