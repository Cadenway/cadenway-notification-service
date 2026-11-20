import type { TransactionScope } from '@cadenway/nest-common/database';
import type { SQL } from 'drizzle-orm';
import { PgDialect } from 'drizzle-orm/pg-core';
import { describe, expect, it, vi } from 'vitest';

import { NotificationPreferences } from '../../../../domain/aggregates/preferences/notification-preferences.aggregate.js';
import type { NotificationPreferencesSnapshot } from '../../../../domain/value-objects/preferences/notification-preferences-snapshot.value-object.js';
import { readActivityPreferencesProvider } from './read-activity-preferences.provider.js';

const accountId = '019a5f3c-8d2e-7c4a-9b1f-3e5d7a9c1b30';

function systemScope(row?: NotificationPreferencesSnapshot) {
  const execute = vi.fn<(statement: SQL) => Promise<void>>().mockResolvedValue();
  const where = vi
    .fn<(condition: SQL) => Promise<readonly NotificationPreferencesSnapshot[]>>()
    .mockResolvedValue(row === undefined ? [] : [row]);
  const select = vi.fn().mockReturnValue({ from: () => ({ where }) });
  const scope = {
    kind: 'system',
    organizationId: null,
    db: { execute, select },
  } as unknown as TransactionScope;
  return { scope, execute, where, select };
}

describe('ReadActivityPreferences provider', () => {
  it('awaits the shared transaction lock before selecting the canonical account', async () => {
    const saved = NotificationPreferences.defaults(accountId).patch({
      channels: { mention: { email: false } },
      digest: 'weekly',
      doNotDisturb: false,
    }).snapshot;
    const { scope, execute, where, select } = systemScope(saved);
    let releaseLock: () => void = () => undefined;
    const lock = new Promise<void>((resolve) => {
      releaseLock = resolve;
    });
    execute.mockReturnValueOnce(lock);
    const reader = await readActivityPreferencesProvider.useFactory();

    const pending = reader.execute(scope, accountId.toUpperCase());
    expect(select).not.toHaveBeenCalled();
    releaseLock();

    await expect(pending).resolves.toEqual(saved);
    const dialect = new PgDialect();
    const lockSql = execute.mock.calls[0]?.[0];
    const filterSql = where.mock.calls[0]?.[0];
    expect(lockSql === undefined ? null : dialect.sqlToQuery(lockSql)).toMatchObject({
      sql: "select pg_advisory_xact_lock(hashtextextended('notification_preferences:' || $1::uuid::text, 0))",
      params: [accountId],
    });
    expect(filterSql === undefined ? null : dialect.sqlToQuery(filterSql)).toMatchObject({
      sql: '"notification_preferences"."user_id" = $1',
      params: [accountId],
    });
  });

  it('returns the domain defaults before a preference is saved', async () => {
    const reader = await readActivityPreferencesProvider.useFactory();
    const { scope } = systemScope();
    await expect(reader.execute(scope, accountId)).resolves.toEqual(
      NotificationPreferences.defaults(accountId).snapshot,
    );
  });

  it('opens and clears a tenant-scoped read for exactly the recipient while locked', async () => {
    const reader = await readActivityPreferencesProvider.useFactory();
    const { scope, execute, select } = systemScope();
    const query = vi.fn().mockResolvedValue(undefined);
    const tenantScope = {
      ...scope,
      kind: 'tenant',
      organizationId: accountId,
      client: { query },
    } as unknown as TransactionScope;
    await expect(reader.execute(tenantScope, accountId.toUpperCase())).resolves.toEqual(
      NotificationPreferences.defaults(accountId).snapshot,
    );
    expect(query.mock.calls).toEqual([
      ["select set_config('app.notification_recipient_id', $1, true)", [accountId]],
      ["select set_config('app.notification_recipient_id', '', true)"],
    ]);
    const [grant, reset] = query.mock.invocationCallOrder;
    expect(grant).toBeGreaterThan(execute.mock.invocationCallOrder[0] ?? 0);
    expect(select.mock.invocationCallOrder[0]).toBeGreaterThan(grant ?? 0);
    expect(reset).toBeGreaterThan(select.mock.invocationCallOrder[0] ?? 0);
  });

  it('clears the tenant recipient after a failed preference query', async () => {
    const reader = await readActivityPreferencesProvider.useFactory();
    const { scope, where } = systemScope();
    const query = vi.fn().mockResolvedValue(undefined);
    const tenantScope = {
      ...scope,
      kind: 'tenant',
      organizationId: accountId,
      client: { query },
    } as unknown as TransactionScope;
    const cause = new Error('read failed');
    where.mockRejectedValueOnce(cause);
    await expect(reader.execute(tenantScope, accountId)).rejects.toBe(cause);
    expect(query).toHaveBeenLastCalledWith(
      "select set_config('app.notification_recipient_id', '', true)",
    );
  });
});
