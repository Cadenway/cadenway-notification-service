import { describe, expect, it, vi } from 'vitest';

import type { PreferencesUnitOfWork } from '../../../../ports/outbound/transactions/preferences/preferences-unit-of-work.port.js';
import { UpdateNotificationPreferences } from './update-notification-preferences.use-case.js';

describe('UpdateNotificationPreferences', () => {
  it('leaves default preferences unpersisted for a no-op and protects first insertion', async () => {
    const store = {
      lockAccount: vi.fn().mockResolvedValue(undefined),
      find: vi.fn().mockResolvedValue(null),
      save: vi.fn().mockResolvedValue(undefined),
    };
    const work: PreferencesUnitOfWork = {
      run: async (_userId, execute) => execute(store),
    };
    const result = await new UpdateNotificationPreferences(work).execute({
      userId: 'camille',
      patch: {},
      expectedVersions: '*',
    });
    expect(store.lockAccount).toHaveBeenCalledWith('camille');
    expect(result.version).toBe(1);
    expect(store.save).not.toHaveBeenCalled();
  });

  it('rejects a stale version without writing', async () => {
    const store = {
      lockAccount: vi.fn().mockResolvedValue(undefined),
      find: vi.fn().mockResolvedValue(null),
      save: vi.fn().mockResolvedValue(undefined),
    };
    const work: PreferencesUnitOfWork = {
      run: async (_userId, execute) => execute(store),
    };
    await expect(
      new UpdateNotificationPreferences(work).execute({
        userId: 'camille',
        patch: { digest: 'weekly' },
        expectedVersions: [2, 3],
      }),
    ).rejects.toMatchObject({ currentVersion: 1 });
    expect(store.save).not.toHaveBeenCalled();
  });
});
