import type { TenantTransactionRunner, TransactionScope } from '@cadenway/nest-common/database';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { DrizzleReminderCandidatesReader } from './drizzle-reminder-candidates.repository.js';

const repository = vi.hoisted(() => ({
  page: vi.fn(),
  selected: vi.fn(),
}));

vi.mock('../../repositories/reminder/drizzle-reminder-records.repository.js', () => ({
  DrizzleReminderRecords: class {
    public pageAtGeneration = repository.page;
    public selectedAtGeneration = repository.selected;
  },
}));

describe('DrizzleReminderCandidatesReader', () => {
  const scope = { organizationId: 'organization' } as TransactionScope;
  const run = vi.fn(async (work: (scope: TransactionScope) => Promise<unknown>) => work(scope));
  const reader = new DrizzleReminderCandidatesReader({ run } as unknown as TenantTransactionRunner);

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('uses one read-only snapshot and an exact lookahead for a full page', async () => {
    const items = [{ snapshot: { id: 'first' } }, { snapshot: { id: 'second' } }];
    repository.page.mockResolvedValue({ generation: '8', items });
    const page = await reader.page({
      organizationId: 'organization',
      userId: 'member',
      expectedGeneration: '8',
      after: null,
      limit: 1,
    });
    expect(repository.page).toHaveBeenCalledWith('member', '8', 2, null);
    expect(run).toHaveBeenCalledWith(expect.any(Function), {
      readOnly: true,
      isolationLevel: 'repeatable read',
    });
    expect(page).toEqual({ generation: '8', items: [items[0]], hasMore: true });
  });

  it('checks the generation for an empty selection in a read-only snapshot', async () => {
    repository.selected.mockResolvedValue([]);
    await expect(
      reader.selected({
        organizationId: 'organization',
        userId: 'member',
        expectedGeneration: '0',
        pairs: [],
      }),
    ).resolves.toEqual([]);
    expect(repository.selected).toHaveBeenCalledWith('member', '0', []);
    expect(run).toHaveBeenCalledWith(expect.any(Function), {
      readOnly: true,
      isolationLevel: 'repeatable read',
    });
  });

  it('allows a lookahead of 101 records for the maximum public page', async () => {
    const items = Array.from({ length: 101 }, (_, id) => ({ snapshot: { id: String(id) } }));
    repository.page.mockResolvedValue({ generation: '4', items });
    const page = await reader.page({
      organizationId: 'organization',
      userId: 'member',
      expectedGeneration: null,
      after: null,
      limit: 100,
    });
    expect(repository.page).toHaveBeenCalledWith('member', null, 101, null);
    expect(page.items).toHaveLength(100);
    expect(page.hasMore).toBe(true);
  });

  it('rejects an out-of-range page before opening a transaction', () => {
    expect(() =>
      reader.page({
        organizationId: 'organization',
        userId: 'member',
        expectedGeneration: null,
        after: null,
        limit: 101,
      }),
    ).toThrow(RangeError);
    expect(run).not.toHaveBeenCalled();
  });
});
