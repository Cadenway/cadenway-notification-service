import { describe, expect, it, vi } from 'vitest';

import type { ActivityEmailStore } from '../../../../ports/outbound/transactions/digest/activity-email-store.port.js';
import type { ActivityEmailUnitOfWork } from '../../../../ports/outbound/transactions/digest/activity-email-unit-of-work.port.js';
import { StageActivityEmail } from './stage-activity-email.use-case.js';

const preferences = {
  version: 1,
  cadence: 'daily',
  enabled: {
    assignment: true,
    comment: true,
    mention: true,
    'status-change': false,
    approval: false,
    access: true,
  },
} as const;

const source = {
  organizationId: 'atelier',
  sourceEventId: 'event',
  actorUserId: 'CAMILLE',
  taskKey: 'CAD-482',
  commentId: null,
  status: null,
};

function fixture() {
  const store = {
    lockIntakePreferences: vi
      .fn<ActivityEmailStore['lockIntakePreferences']>()
      .mockImplementation((_organizationId, userIds) =>
        Promise.resolve(new Map(userIds.map((id) => [id, preferences]))),
      ),
    insertCandidates: vi.fn<ActivityEmailStore['insertCandidates']>().mockResolvedValue(['ines']),
    enqueuePlan: vi.fn<ActivityEmailStore['enqueuePlan']>().mockResolvedValue(undefined),
    lockPreferences: vi.fn(),
    listPendingCandidateIds: vi.fn(),
    reserveIndividuals: vi.fn(),
    findDigestSlot: vi.fn(),
    countDigestAssignments: vi.fn(),
    reserveDigest: vi.fn(),
    assignCandidates: vi.fn(),
    enqueueDelivery: vi.fn(),
  } satisfies ActivityEmailStore;
  const work: ActivityEmailUnitOfWork = {
    runTenant: async (_organizationId, run) => run(store),
    runAccount: vi.fn(),
  };
  return { useCase: new StageActivityEmail(work, () => 42), ...store };
}

describe('StageActivityEmail', () => {
  it('stages the first audience once per account and plans only the newly inserted recipient', async () => {
    const { useCase, lockIntakePreferences, insertCandidates, enqueuePlan } = fixture();
    const result = await useCase.execute({
      source,
      audiences: [
        { kind: 'mention', recipientIds: ['CAMILLE', 'INES', 'AMELIE'] },
        { kind: 'assignment', recipientIds: ['ines'] },
      ],
    });

    expect(result).toBe(1);
    expect(lockIntakePreferences).toHaveBeenCalledExactlyOnceWith('atelier', ['amelie', 'ines']);
    expect(insertCandidates).toHaveBeenCalledExactlyOnceWith('atelier', [
      expect.objectContaining({ recipientId: 'amelie', kind: 'mention' }),
      expect.objectContaining({ recipientId: 'ines', kind: 'mention' }),
    ]);
    expect(enqueuePlan).toHaveBeenCalledExactlyOnceWith('ines', 42);
  });

  it.each([
    { cadence: 'never', kind: 'assignment' },
    { cadence: 'daily', kind: 'status-change' },
  ] as const)(
    'drops candidates blocked by $cadence or $kind at intake',
    async ({ cadence, kind }) => {
      const { useCase, lockIntakePreferences, insertCandidates, enqueuePlan } = fixture();
      lockIntakePreferences.mockResolvedValue(new Map([['ines', { ...preferences, cadence }]]));
      await expect(
        useCase.execute({ source, audiences: [{ kind, recipientIds: ['ines'] }] }),
      ).resolves.toBe(0);
      expect(insertCandidates).not.toHaveBeenCalled();
      expect(enqueuePlan).not.toHaveBeenCalled();
    },
  );
});
