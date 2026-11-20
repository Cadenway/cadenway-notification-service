import type { TenantTransactionRunner, TransactionScope } from '@cadenway/nest-common/database';
import { describe, expect, it, vi } from 'vitest';

import { DrizzleReminderAuthorizationUnitOfWork } from './drizzle-reminder-authorization.unit-of-work.js';

describe('DrizzleReminderAuthorizationUnitOfWork', () => {
  it('passes the active tenant transaction to an authorized callback', async () => {
    const scope = { organizationId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' } as TransactionScope;
    const runner = {
      run: async (work: (transaction: TransactionScope) => Promise<unknown>) => work(scope),
    } as TenantTransactionRunner;
    const request = vi.fn();
    const due = vi.fn();
    const retry = vi.fn<() => Promise<void>>().mockResolvedValue(undefined);
    const work = new DrizzleReminderAuthorizationUnitOfWork(runner, request, due, retry);
    const next = {
      organizationId: scope.organizationId ?? '',
      userId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
      reminderId: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
      attemptId: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd',
      scheduleVersion: 1,
      retryCount: 1,
      runAt: 1_000,
    };

    await expect(work.run(next.organizationId, (store) => store.scheduleRetry(next))).resolves.toBe(
      undefined,
    );
    expect(retry).toHaveBeenCalledExactlyOnceWith(scope, next);
    expect(request).not.toHaveBeenCalled();
    expect(due).not.toHaveBeenCalled();
  });

  it('rejects an organization different from the runner context', async () => {
    const scope = { organizationId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' } as TransactionScope;
    const runner = {
      run: async (work: (transaction: TransactionScope) => Promise<unknown>) => work(scope),
    } as TenantTransactionRunner;
    const callback = vi.fn();
    const work = new DrizzleReminderAuthorizationUnitOfWork(runner, vi.fn(), vi.fn(), vi.fn());

    await expect(work.run('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', callback)).rejects.toThrow(
      'tenant scope mismatch',
    );
    expect(callback).not.toHaveBeenCalled();
  });
});
