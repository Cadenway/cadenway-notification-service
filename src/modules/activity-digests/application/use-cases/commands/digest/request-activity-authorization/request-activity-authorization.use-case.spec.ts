import { describe, expect, it, vi } from 'vitest';

import type { ActivityAuthorizationCandidate } from '../../../../models/digest/activity-authorization-candidate.model.js';
import type { ActivityDeliveryStore } from '../../../../ports/outbound/transactions/digest/activity-delivery-store.port.js';
import type { ActivityDeliveryUnitOfWork } from '../../../../ports/outbound/transactions/digest/activity-delivery-unit-of-work.port.js';
import { RequestActivityAuthorization } from './request-activity-authorization.use-case.js';

const input = {
  organizationId: 'atelier',
  userId: 'ines',
  occurrenceId: 'batch',
  generation: 2,
  expiresAt: 200,
};

function fixture() {
  const listAuthorizationCandidates = vi.fn<ActivityDeliveryStore['listAuthorizationCandidates']>();
  const reserveAuthorizationAttempts =
    vi.fn<ActivityDeliveryStore['reserveAuthorizationAttempts']>();
  const appendAuthorization = vi.fn<ActivityDeliveryStore['appendAuthorization']>();
  const store = {
    lockAttempt: vi.fn<ActivityDeliveryStore['lockAttempt']>(),
    finishAttempt: vi.fn<ActivityDeliveryStore['finishAttempt']>(),
    skipRecipient: vi.fn<ActivityDeliveryStore['skipRecipient']>(),
    listAuthorizationCandidates,
    reserveAuthorizationAttempts,
    appendAuthorization,
    lockDueOccurrence: vi.fn<ActivityDeliveryStore['lockDueOccurrence']>(),
    readPreferences: vi.fn<ActivityDeliveryStore['readPreferences']>(),
    listDeliveryDecisions: vi.fn<ActivityDeliveryStore['listDeliveryDecisions']>(),
    claim: vi.fn<ActivityDeliveryStore['claim']>(),
    supersede: vi.fn<ActivityDeliveryStore['supersede']>(),
    enqueuePlan: vi.fn<ActivityDeliveryStore['enqueuePlan']>(),
    finish: vi.fn<ActivityDeliveryStore['finish']>(),
    release: vi.fn<ActivityDeliveryStore['release']>(),
  } satisfies ActivityDeliveryStore;
  const runTenant = vi.fn();
  const work: ActivityDeliveryUnitOfWork = {
    runAccount: vi.fn(),
    runTenant: (id, run) => {
      runTenant(id, run);
      return run(store);
    },
  };
  return {
    work,
    runTenant,
    listAuthorizationCandidates,
    reserveAuthorizationAttempts,
    appendAuthorization,
  };
}

function candidate(
  candidateId: string,
  outcome: ActivityAuthorizationCandidate['outcome'],
  expiresAt: number | null,
  validUntil: number | null,
): ActivityAuthorizationCandidate {
  return { candidateId, taskKey: 'CAD-482', outcome, expiresAt, validUntil };
}

describe('RequestActivityAuthorization', () => {
  it('appends only fresh correlations reserved within the originating tenant transaction', async () => {
    const {
      work,
      runTenant,
      listAuthorizationCandidates,
      reserveAuthorizationAttempts,
      appendAuthorization,
    } = fixture();
    listAuthorizationCandidates.mockResolvedValue([
      candidate('new', null, null, null),
      candidate('waiting', 'pending', 101, null),
      candidate('lapsed', 'pending', 100, null),
      candidate('authorized', 'permitted', 150, 101),
      candidate('elapsed-permit', 'permitted', 150, 100),
      candidate('expired', 'expired', 100, 100),
      candidate('denied', 'denied', 99, 98),
    ]);
    reserveAuthorizationAttempts.mockResolvedValue([
      { attemptId: 'attempt-new', candidateId: 'new' },
      { attemptId: 'attempt-expired', candidateId: 'expired' },
    ]);

    await expect(new RequestActivityAuthorization(work, () => 100).execute(input)).resolves.toBe(
      true,
    );
    expect(runTenant).toHaveBeenCalledWith('atelier', expect.any(Function));
    expect(listAuthorizationCandidates).toHaveBeenCalledExactlyOnceWith(
      'atelier',
      'ines',
      'batch',
      2,
    );
    expect(reserveAuthorizationAttempts).toHaveBeenCalledExactlyOnceWith(
      'atelier',
      'ines',
      'batch',
      2,
      200,
      ['new', 'lapsed', 'elapsed-permit', 'expired'],
    );
    expect(appendAuthorization.mock.calls).toEqual([
      [
        {
          organizationId: 'atelier',
          recipientId: 'ines',
          attemptId: 'attempt-new',
          taskKey: 'CAD-482',
          expiresAt: 200,
        },
      ],
      [
        {
          organizationId: 'atelier',
          recipientId: 'ines',
          attemptId: 'attempt-expired',
          taskKey: 'CAD-482',
          expiresAt: 200,
        },
      ],
    ]);
  });

  it('fails the transaction if its authorization deadline expires during staging', async () => {
    const { work, listAuthorizationCandidates, reserveAuthorizationAttempts, appendAuthorization } =
      fixture();
    listAuthorizationCandidates.mockResolvedValue([candidate('new', null, null, null)]);
    reserveAuthorizationAttempts.mockResolvedValue([
      { attemptId: 'attempt-new', candidateId: 'new' },
    ]);
    const clock = vi
      .fn()
      .mockReturnValueOnce(100)
      .mockReturnValueOnce(110)
      .mockReturnValueOnce(200);
    await expect(new RequestActivityAuthorization(work, clock).execute(input)).rejects.toThrow(
      'expired',
    );
    expect(appendAuthorization).toHaveBeenCalledOnce();
  });
});
