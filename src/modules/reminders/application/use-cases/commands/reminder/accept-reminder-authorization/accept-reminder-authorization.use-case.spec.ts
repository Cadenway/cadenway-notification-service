import { describe, expect, it, vi } from 'vitest';

import { Reminder } from '../../../../../domain/aggregates/reminder/reminder.aggregate.js';
import type { ReminderAuthorizationAttempt } from '../../../../models/reminder/reminder-authorization-attempt.model.js';
import type { ReminderAuthorizationStore } from '../../../../ports/outbound/transactions/reminder/reminder-authorization-store.port.js';
import type { ReminderAuthorizationUnitOfWork } from '../../../../ports/outbound/transactions/reminder/reminder-authorization-unit-of-work.port.js';
import { RequestReminderAuthorization } from '../request-reminder-authorization/request-reminder-authorization.use-case.js';
import { AcceptReminderAuthorization } from './accept-reminder-authorization.use-case.js';

const initial = Reminder.schedule(
  {
    id: 'r',
    organizationId: 'org',
    userId: 'user',
    taskId: 'task',
    remindAt: 2000,
    note: 'private',
  },
  1000,
);
const request = {
  organizationId: 'org',
  userId: 'user',
  reminderId: 'r',
  scheduleVersion: 1,
  expiresAt: 3000,
  retryCount: 0,
  previousAttemptId: null,
};
const decision = {
  organizationId: 'org',
  attemptId: 'attempt',
  decision: 'permit' as const,
  decidedAt: 2100,
  validUntil: 2900,
};

function fixture() {
  let reminder = initial;
  let now = 2200;
  let attempt: ReminderAuthorizationAttempt | null = null;
  const allocateAttemptId = vi
    .fn<ReminderAuthorizationStore['allocateAttemptId']>()
    .mockResolvedValueOnce('attempt')
    .mockResolvedValueOnce('next');
  const requestAuthorization = vi.fn<ReminderAuthorizationStore['requestAuthorization']>(
    (value) => {
      attempt = value;
      return Promise.resolve();
    },
  );
  const finishAttempt = vi.fn<ReminderAuthorizationStore['finishAttempt']>((_org, _id, status) => {
    if (attempt !== null) attempt = { ...attempt, status };
    return Promise.resolve();
  });
  const recordDue = vi.fn<ReminderAuthorizationStore['recordDue']>().mockResolvedValue(undefined);
  const scheduleRetry = vi
    .fn<ReminderAuthorizationStore['scheduleRetry']>()
    .mockResolvedValue(undefined);
  const lockCurrentAttempt = vi.fn<ReminderAuthorizationStore['lockCurrentAttempt']>((org, id) =>
    Promise.resolve(
      attempt !== null && attempt.organizationId === org && attempt.reminderId === id
        ? attempt
        : null,
    ),
  );
  const store: ReminderAuthorizationStore = {
    allocateAttemptId,
    findAttempt: vi.fn((org, id) =>
      Promise.resolve(
        attempt !== null && attempt.organizationId === org && attempt.id === id ? attempt : null,
      ),
    ),
    lockReminder: vi.fn((org, user, id) =>
      Promise.resolve(
        reminder.snapshot.organizationId === org &&
          reminder.snapshot.userId === user &&
          reminder.snapshot.id === id
          ? reminder
          : null,
      ),
    ),
    lockCurrentAttempt,
    requestAuthorization,
    scheduleRetry,
    finishAttempt,
    save: vi.fn<ReminderAuthorizationStore['save']>((value) => {
      reminder = value;
      return Promise.resolve();
    }),
    recordDue,
  };
  const work: ReminderAuthorizationUnitOfWork = {
    run: async (_organizationId, execute) => execute(store),
  };
  return {
    store,
    requestAuthorization,
    scheduleRetry,
    finishAttempt,
    recordDue,
    lockCurrentAttempt,
    allocateAttemptId,
    request: new RequestReminderAuthorization(work, () => now),
    accept: new AcceptReminderAuthorization(work, () => now),
    setNow: (value: number) => {
      now = value;
    },
    change: (value: Reminder) => {
      reminder = value;
    },
  };
}

describe('reminder delivery authorization', () => {
  it('stages one redacted request and atomically records one due fact', async () => {
    const f = fixture();
    expect(await f.request.execute(request)).toBe(true);
    expect(await f.request.execute(request)).toBe(false);
    expect(f.requestAuthorization).toHaveBeenCalledOnce();
    expect(f.allocateAttemptId).toHaveBeenCalledOnce();
    expect(f.requestAuthorization).toHaveBeenCalledWith({
      id: 'attempt',
      organizationId: 'org',
      reminderId: 'r',
      userId: 'user',
      taskId: 'task',
      reminderVersion: 1,
      scheduleVersion: 1,
      expiresAt: 3000,
      status: 'pending',
    });
    expect(f.scheduleRetry).toHaveBeenCalledWith({
      organizationId: 'org',
      userId: 'user',
      reminderId: 'r',
      scheduleVersion: 1,
      attemptId: 'attempt',
      runAt: 3000,
      retryCount: 1,
    });
    expect(await f.accept.execute(decision)).toBe(true);
    expect(await f.accept.execute(decision)).toBe(false);
    expect(f.recordDue).toHaveBeenCalledOnce();
    expect(f.finishAttempt).toHaveBeenCalledWith('org', 'attempt', 'permitted');
  });

  it.each([
    { organizationId: 'other' },
    { attemptId: 'wrong' },
    { validUntil: 3001 },
    { decidedAt: 2900 },
  ])('ignores an out-of-scope or expired decision %o', async (change) => {
    const f = fixture();
    await f.request.execute(request);
    expect(await f.accept.execute({ ...decision, ...change })).toBe(false);
    expect(f.recordDue).not.toHaveBeenCalled();
  });

  it('ignores a decision whose permit expires while waiting for locks', async () => {
    const f = fixture();
    await f.request.execute(request);
    f.lockCurrentAttempt.mockImplementationOnce(() => {
      f.setNow(2900);
      return Promise.resolve({
        id: 'attempt',
        organizationId: 'org',
        reminderId: 'r',
        userId: 'user',
        taskId: 'task',
        reminderVersion: 1,
        scheduleVersion: 1,
        expiresAt: 3000,
        status: 'pending',
      });
    });
    expect(await f.accept.execute(decision)).toBe(false);
    expect(f.recordDue).not.toHaveBeenCalled();
  });

  it('leaves a due job retryable when its deadline passed while waiting for its lock', async () => {
    const f = fixture();
    f.lockCurrentAttempt.mockImplementationOnce(() => {
      f.setNow(3000);
      return Promise.resolve(null);
    });
    await expect(f.request.execute(request)).rejects.toThrow(
      'Reminder authorization expired during processing.',
    );
    expect(f.requestAuthorization).not.toHaveBeenCalled();
    expect(f.allocateAttemptId).not.toHaveBeenCalled();
  });

  it('throws to roll back if staging runs past the attempt deadline', async () => {
    const f = fixture();
    f.requestAuthorization.mockImplementationOnce(() => {
      f.setNow(3000);
      return Promise.resolve();
    });
    await expect(f.request.execute(request)).rejects.toThrow(
      'Reminder authorization expired during processing.',
    );
  });

  it('throws after writes when the permit expires before transaction completion', async () => {
    const f = fixture();
    await f.request.execute(request);
    f.recordDue.mockImplementation(() => {
      f.setNow(2900);
      return Promise.resolve();
    });
    await expect(f.accept.execute(decision)).rejects.toThrow(
      'Reminder authorization expired during processing.',
    );
  });

  it('does not fire a reminder changed or completed after authorization was requested', async () => {
    for (const changed of [
      initial.changeNote('updated'),
      initial.snooze(4000, 2000),
      initial.complete(2000),
    ]) {
      const f = fixture();
      await f.request.execute(request);
      f.change(changed);
      expect(await f.accept.execute(decision)).toBe(false);
      expect(f.recordDue).not.toHaveBeenCalled();
    }
  });

  it('keeps a denial terminal after its expiry and a note change', async () => {
    const f = fixture();
    await f.request.execute(request);
    expect(await f.accept.execute({ ...decision, decision: 'deny' })).toBe(false);
    expect(await f.accept.execute(decision)).toBe(false);
    f.change(initial.changeNote('updated'));
    f.setNow(3000);
    expect(
      await f.request.execute({
        ...request,
        expiresAt: 4000,
        retryCount: 1,
        previousAttemptId: 'attempt',
      }),
    ).toBe(false);
    expect(f.allocateAttemptId).toHaveBeenCalledOnce();
    f.setNow(3100);
    expect(await f.accept.execute({ ...decision, validUntil: 3900 })).toBe(false);
    expect(f.recordDue).not.toHaveBeenCalled();
  });

  it('replaces an expired unanswered attempt after a note change', async () => {
    const f = fixture();
    await f.request.execute(request);
    f.change(initial.changeNote('updated'));
    f.setNow(3000);
    expect(
      await f.request.execute({
        ...request,
        expiresAt: 4000,
        retryCount: 1,
        previousAttemptId: 'attempt',
      }),
    ).toBe(true);
    expect(f.finishAttempt).toHaveBeenCalledWith('org', 'attempt', 'expired');
    expect(f.requestAuthorization).toHaveBeenLastCalledWith(
      expect.objectContaining({
        id: 'next',
        reminderVersion: 2,
        scheduleVersion: 1,
      }),
    );
    expect(f.scheduleRetry).toHaveBeenLastCalledWith(
      expect.objectContaining({
        attemptId: 'next',
        runAt: 4000,
        retryCount: 2,
      }),
    );
  });

  it('fails the job after the bounded unanswered attempts', async () => {
    const f = fixture();
    await f.request.execute(request);
    f.setNow(3000);
    await expect(
      f.request.execute({
        ...request,
        expiresAt: 4000,
        retryCount: 10,
        previousAttemptId: 'attempt',
      }),
    ).rejects.toThrow('Reminder authorization retries exhausted.');
    expect(f.requestAuthorization).toHaveBeenCalledOnce();
  });

  it('ignores a replay from an earlier authorization chain', async () => {
    const f = fixture();
    await f.request.execute(request);
    f.setNow(3000);
    await f.request.execute({
      ...request,
      expiresAt: 4000,
      retryCount: 1,
      previousAttemptId: 'attempt',
    });
    f.setNow(4000);
    expect(
      await f.request.execute({
        ...request,
        expiresAt: 5000,
        retryCount: 1,
        previousAttemptId: 'attempt',
      }),
    ).toBe(false);
    expect(await f.request.execute({ ...request, expiresAt: 5000 })).toBe(false);
    expect(f.requestAuthorization).toHaveBeenCalledTimes(2);
  });

  it('starts a new schedule even when the prior schedule has an authorization attempt', async () => {
    const f = fixture();
    await f.request.execute(request);
    f.change(initial.snooze(4000, 2000));
    f.setNow(4000);
    expect(await f.request.execute({ ...request, scheduleVersion: 2, expiresAt: 5000 })).toBe(true);
    expect(f.finishAttempt).toHaveBeenCalledWith('org', 'attempt', 'expired');
    expect(f.requestAuthorization).toHaveBeenLastCalledWith(
      expect.objectContaining({
        id: 'next',
        scheduleVersion: 2,
      }),
    );
  });

  it('rejects invalid retry counters and authorization durations', async () => {
    const f = fixture();
    for (const retryCount of [-1, 11, 1.5, Number.NaN]) {
      expect(() => f.request.execute({ ...request, retryCount })).toThrow(RangeError);
    }
    await expect(f.request.execute({ ...request, expiresAt: 32_201 })).rejects.toThrow(RangeError);
    expect(f.requestAuthorization).not.toHaveBeenCalled();
  });
});
