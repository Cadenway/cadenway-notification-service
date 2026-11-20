import type { TenantTransactionRunner, TransactionScope } from '@cadenway/nest-common/database';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { DrizzleInAppNotificationEnabled } from './drizzle-in-app-notification-enabled.repository.js';
import { DrizzlePreferencesStore } from './drizzle-preferences-store.repository.js';

const USER_ID: string = '019a5f3c-8d2e-7c4a-9b1f-3e5d7a9c1b30';
const ORGANIZATION_ID: string = '019a5f3c-8d2e-7c4a-9b1f-3e5d7a9c1b2f';

/** Binds a tenant scope while allowing the preference query to be checked in isolation. */
function fixture(): {
  readonly reader: DrizzleInAppNotificationEnabled;
  readonly query: ReturnType<typeof vi.fn>;
} {
  const query = vi.fn().mockResolvedValue({ rows: [] });
  const scope = {
    organizationId: ORGANIZATION_ID,
    db: {},
    client: { query },
  } as unknown as TransactionScope;
  const runner = {
    run: (work: (active: TransactionScope) => Promise<unknown>) => work(scope),
  } as unknown as TenantTransactionRunner;
  return { reader: new DrizzleInAppNotificationEnabled(runner), query };
}

afterEach(() => vi.restoreAllMocks());

describe('DrizzleInAppNotificationEnabled', () => {
  it('locks the exact account and checks the saved channel while clearing the local setting', async () => {
    const { reader, query } = fixture();
    const lock = vi.spyOn(DrizzlePreferencesStore.prototype, 'lockAccount').mockResolvedValue();
    query.mockResolvedValueOnce({ rows: [] }).mockResolvedValueOnce({ rows: [{ enabled: false }] });

    await expect(reader.execute(USER_ID.toUpperCase(), 'mention')).resolves.toBe(false);
    expect(lock).toHaveBeenCalledExactlyOnceWith(USER_ID);
    expect(query).toHaveBeenNthCalledWith(
      1,
      "select set_config('app.notification_recipient_id', $1, true)",
      [USER_ID],
    );
    expect(query).toHaveBeenNthCalledWith(
      2,
      "select channels -> $2 -> 'inApp' as enabled from notification_preferences where user_id = $1::uuid",
      [USER_ID, 'mention'],
    );
    expect(query).toHaveBeenNthCalledWith(
      3,
      "select set_config('app.notification_recipient_id', '', true)",
    );
  });

  it('uses the account defaults when no preferences are saved', async () => {
    const { reader } = fixture();
    vi.spyOn(DrizzlePreferencesStore.prototype, 'lockAccount').mockResolvedValue();
    await expect(reader.execute(USER_ID, 'assignment')).resolves.toBe(true);
  });

  it('clears the recipient setting after a failed read', async () => {
    const { reader, query } = fixture();
    vi.spyOn(DrizzlePreferencesStore.prototype, 'lockAccount').mockResolvedValue();
    query.mockResolvedValueOnce({ rows: [] }).mockRejectedValueOnce(new Error('read failed'));
    await expect(reader.execute(USER_ID, 'access')).rejects.toThrow('read failed');
    expect(query).toHaveBeenLastCalledWith(
      "select set_config('app.notification_recipient_id', '', true)",
    );
  });

  it('rejects a saved non-boolean value rather than applying defaults', async () => {
    const { reader, query } = fixture();
    vi.spyOn(DrizzlePreferencesStore.prototype, 'lockAccount').mockResolvedValue();
    query.mockResolvedValueOnce({ rows: [] }).mockResolvedValueOnce({ rows: [{ enabled: null }] });
    await expect(reader.execute(USER_ID, 'access')).rejects.toThrow(
      'Invalid in-app notification preference',
    );
    expect(query).toHaveBeenLastCalledWith(
      "select set_config('app.notification_recipient_id', '', true)",
    );
  });

  it('preserves the original database failure if cleanup also fails', async () => {
    const { reader, query } = fixture();
    vi.spyOn(DrizzlePreferencesStore.prototype, 'lockAccount').mockResolvedValue();
    query
      .mockResolvedValueOnce({ rows: [] })
      .mockRejectedValueOnce(new Error('read failed'))
      .mockRejectedValueOnce(new Error('transaction aborted'));
    await expect(reader.execute(USER_ID, 'access')).rejects.toThrow('read failed');
  });

  it('fails if cleanup fails after a successful read', async () => {
    const { reader, query } = fixture();
    vi.spyOn(DrizzlePreferencesStore.prototype, 'lockAccount').mockResolvedValue();
    query
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [{ enabled: true }] })
      .mockRejectedValueOnce(new Error('cleanup failed'));
    await expect(reader.execute(USER_ID, 'access')).rejects.toThrow('cleanup failed');
  });
});
