import { describe, expect, it, vi } from 'vitest';

import type { ActivityEmailPreferences } from '../../../../models/digest/activity-email-preferences.model.js';
import type { ActivityRecipientReader } from '../../../../ports/outbound/identity/digest/activity-recipient-reader.port.js';
import type { ActivityEmailStore } from '../../../../ports/outbound/transactions/digest/activity-email-store.port.js';
import type { ActivityEmailUnitOfWork } from '../../../../ports/outbound/transactions/digest/activity-email-unit-of-work.port.js';
import { PlanActivityEmail } from './plan-activity-email.use-case.js';

const fridayAtNine = Date.parse('2026-03-27T08:00:00Z');
const mondayAtNine = Date.parse('2026-03-30T07:00:00Z');
const followingMondayAtNine = Date.parse('2026-04-06T07:00:00Z');
const reservation = { id: 'digest-1', generation: 1 };
const preferences: ActivityEmailPreferences = {
  version: 2,
  cadence: 'daily',
  enabled: {
    assignment: true,
    comment: false,
    mention: true,
    'status-change': false,
    approval: false,
    access: true,
  },
};
const recipient = {
  userId: 'ines',
  email: 'ines@example.test',
  language: 'fr',
  timeZone: 'Europe/Paris',
  version: 3,
};

function fixture() {
  const store = {
    lockIntakePreferences: vi.fn(),
    insertCandidates: vi.fn(),
    lockPreferences: vi.fn<ActivityEmailStore['lockPreferences']>().mockResolvedValue(preferences),
    listPendingCandidateIds: vi
      .fn<ActivityEmailStore['listPendingCandidateIds']>()
      .mockResolvedValue(['candidate']),
    reserveIndividuals: vi.fn<ActivityEmailStore['reserveIndividuals']>(),
    findDigestSlot: vi.fn<ActivityEmailStore['findDigestSlot']>().mockResolvedValue(null),
    countDigestAssignments: vi.fn<ActivityEmailStore['countDigestAssignments']>(),
    reserveDigest: vi.fn<ActivityEmailStore['reserveDigest']>().mockResolvedValue(reservation),
    assignCandidates: vi.fn<ActivityEmailStore['assignCandidates']>().mockResolvedValue(undefined),
    enqueuePlan: vi.fn<ActivityEmailStore['enqueuePlan']>().mockResolvedValue(undefined),
    enqueueDelivery: vi.fn<ActivityEmailStore['enqueueDelivery']>().mockResolvedValue(undefined),
  } satisfies ActivityEmailStore;
  const openAccount = vi.fn<(id: string) => void>();
  const work: ActivityEmailUnitOfWork = {
    runTenant: vi.fn(),
    runAccount: (id, run) => {
      openAccount(id);
      return run(store);
    },
  };
  const recipients = {
    findCurrent: vi.fn<ActivityRecipientReader['findCurrent']>().mockResolvedValue(recipient),
  };
  return { store, openAccount, recipients, planner: new PlanActivityEmail(recipients, work) };
}

describe('PlanActivityEmail', () => {
  it('plans in the account time zone and atomically enqueues the new reservation', async () => {
    const { planner, store } = fixture();

    await expect(planner.execute({ userId: 'ines', notBeforeMs: fridayAtNine })).resolves.toBe(1);
    expect(store.listPendingCandidateIds).toHaveBeenCalledExactlyOnceWith(
      'ines',
      ['assignment', 'mention', 'access'],
      fridayAtNine,
      100,
    );
    expect(store.reserveDigest).toHaveBeenCalledExactlyOnceWith(
      'ines',
      expect.objectContaining({ localDate: '2026-03-27', profileVersion: 3 }),
      preferences.version,
    );
    expect(store.assignCandidates).toHaveBeenCalledExactlyOnceWith('ines', [
      { candidateId: 'candidate', reservation },
    ]);
    expect(store.enqueueDelivery).toHaveBeenCalledExactlyOnceWith(
      'ines',
      reservation,
      fridayAtNine,
    );
    expect(store.enqueuePlan).not.toHaveBeenCalled();
  });

  it('fills the same future slot across a revision of the account preferences', async () => {
    const { planner, store } = fixture();
    store.lockPreferences.mockResolvedValue({ ...preferences, version: 11 });
    store.findDigestSlot.mockResolvedValue({
      ...reservation,
      state: 'scheduled',
      dueAtMs: fridayAtNine,
      profileVersion: recipient.version,
      acceptsAssignments: true,
    });
    store.countDigestAssignments.mockResolvedValue(99);

    await expect(planner.execute({ userId: 'ines', notBeforeMs: fridayAtNine })).resolves.toBe(0);
    expect(store.assignCandidates).toHaveBeenCalledExactlyOnceWith('ines', [
      { candidateId: 'candidate', reservation },
    ]);
    expect(store.reserveDigest).not.toHaveBeenCalled();
    expect(store.enqueueDelivery).not.toHaveBeenCalled();
    expect(store.enqueuePlan).not.toHaveBeenCalled();
  });

  it('bounds a weekly digest to one slot and carries the 101st candidate to the next Monday', async () => {
    const { planner, store } = fixture();
    const page = Array.from({ length: 101 }, (_, index) => `candidate-${String(index)}`);
    const overflow = 'candidate-100';
    const next = { id: 'digest-2', generation: 1 };
    store.lockPreferences.mockResolvedValue({ ...preferences, cadence: 'weekly' });
    store.listPendingCandidateIds.mockResolvedValueOnce(page).mockResolvedValue([overflow]);
    store.findDigestSlot
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({
        ...reservation,
        state: 'scheduled',
        dueAtMs: mondayAtNine,
        profileVersion: recipient.version,
        acceptsAssignments: true,
      })
      .mockResolvedValue(null);
    store.countDigestAssignments.mockResolvedValue(100);
    store.reserveDigest.mockResolvedValueOnce(reservation).mockResolvedValue(next);

    await expect(planner.execute({ userId: 'ines', notBeforeMs: fridayAtNine })).resolves.toBe(1);
    await expect(planner.execute({ userId: 'ines', notBeforeMs: fridayAtNine })).resolves.toBe(0);
    expect(store.assignCandidates).toHaveBeenCalledExactlyOnceWith(
      'ines',
      page.slice(0, 100).map((candidateId) => ({ candidateId, reservation })),
    );
    expect(store.enqueueDelivery).toHaveBeenCalledExactlyOnceWith(
      'ines',
      reservation,
      mondayAtNine,
    );
    expect(store.enqueuePlan.mock.calls).toEqual([
      ['ines', mondayAtNine + 1, mondayAtNine + 1],
      ['ines', mondayAtNine + 1, mondayAtNine + 1],
    ]);

    await expect(planner.execute({ userId: 'ines', notBeforeMs: mondayAtNine + 1 })).resolves.toBe(
      1,
    );
    expect(store.assignCandidates).toHaveBeenNthCalledWith(2, 'ines', [
      { candidateId: overflow, reservation: next },
    ]);
    expect(store.enqueueDelivery).toHaveBeenNthCalledWith(2, 'ines', next, followingMondayAtNine);
    expect(store.reserveDigest.mock.calls.map(([, occurrence]) => occurrence.localDate)).toEqual([
      '2026-03-30',
      '2026-04-06',
    ]);
  });

  it('does not open a transaction for an unverified or deleted recipient', async () => {
    const { planner, recipients, openAccount } = fixture();
    recipients.findCurrent.mockResolvedValue(null);
    await expect(planner.execute({ userId: 'ines', notBeforeMs: 1 })).resolves.toBe(0);
    expect(openAccount).not.toHaveBeenCalled();
  });
});
