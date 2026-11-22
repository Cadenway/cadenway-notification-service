import type { TransactionScope } from '@cadenway/nest-common/database';
import type { SQL } from 'drizzle-orm';
import { PgDialect } from 'drizzle-orm/pg-core';
import { describe, expect, it, vi } from 'vitest';

import { NotificationPreferences } from '../../../../domain/aggregates/preferences/notification-preferences.aggregate.js';
import type { NotificationPreferencesSnapshot } from '../../../../domain/value-objects/preferences/notification-preferences-snapshot.value-object.js';
import { readActivityPreferencesProvider } from './read-activity-preferences.provider.js';

const accountId = '019a5f3c-8d2e-7c4a-9b1f-3e5d7a9c1b30';
const nextAccountId = '019a5f3c-8d2e-7c4a-9b1f-3e5d7a9c1b31';

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

function tenantScope() {
  const { scope, ...db } = systemScope();
  const query = vi.fn().mockResolvedValue(undefined);
  return {
    ...db,
    query,
    scope: {
      ...scope,
      kind: 'tenant',
      organizationId: accountId,
      client: { query },
    } as unknown as TransactionScope,
  };
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
    const { scope, execute, select, query } = tenantScope();
    await expect(reader.execute(scope, accountId.toUpperCase())).resolves.toEqual(
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
    const { scope, where, query } = tenantScope();
    const cause = new Error('read failed');
    where.mockRejectedValueOnce(cause);
    await expect(reader.execute(scope, accountId)).rejects.toBe(cause);
    expect(query).toHaveBeenLastCalledWith(
      "select set_config('app.notification_recipient_id', '', true)",
    );
  });

  it('locks distinct recipients with one ordered statement before opening each read scope', async () => {
    const reader = await readActivityPreferencesProvider.useFactory();
    const { scope, execute, where, select, query } = tenantScope();
    const saved = NotificationPreferences.defaults(accountId).patch({
      channels: { mention: { email: false } },
      digest: 'weekly',
      doNotDisturb: false,
    }).snapshot;
    where.mockResolvedValueOnce([saved]);
    let releaseLocks: () => void = () => undefined;
    execute.mockReturnValueOnce(
      new Promise<void>((resolve) => {
        releaseLocks = resolve;
      }),
    );

    const pending = reader.executeForRecipients(scope, [
      nextAccountId,
      accountId.toUpperCase(),
      accountId,
    ]);
    expect(execute).toHaveBeenCalledTimes(1);
    expect(query).not.toHaveBeenCalled();
    expect(select).not.toHaveBeenCalled();
    releaseLocks();

    const results = await pending;
    expect([...results.keys()]).toEqual([accountId, nextAccountId]);
    expect(results.get(accountId)).toEqual(saved);
    expect(results.get(nextAccountId)).toEqual(
      NotificationPreferences.defaults(nextAccountId).snapshot,
    );
    const lock = execute.mock.calls[0]?.[0];
    expect(lock === undefined ? null : new PgDialect().sqlToQuery(lock)).toMatchObject({
      sql: "select pg_advisory_xact_lock(hashtextextended('notification_preferences:' || account_id::uuid::text, 0)) from unnest($1::uuid[]) as batch(account_id) order by account_id",
      params: [[accountId, nextAccountId]],
    });
    expect(query.mock.calls).toEqual([
      ["select set_config('app.notification_recipient_id', $1, true)", [accountId]],
      ["select set_config('app.notification_recipient_id', '', true)"],
      ["select set_config('app.notification_recipient_id', $1, true)", [nextAccountId]],
      ["select set_config('app.notification_recipient_id', '', true)"],
    ]);
    expect(select).toHaveBeenCalledTimes(2);
    expect(query.mock.invocationCallOrder[1]).toBeGreaterThan(
      select.mock.invocationCallOrder[0] ?? 0,
    );
    expect(query.mock.invocationCallOrder[3]).toBeGreaterThan(
      select.mock.invocationCallOrder[1] ?? 0,
    );
  });

  it('keeps subsequent lock batches in the same UUID order', async () => {
    const reader = await readActivityPreferencesProvider.useFactory();
    const { scope, execute, where } = tenantScope();
    const accountIds = Array.from(
      { length: 251 },
      (_, index): string => `019a5f3c-8d2e-7c4a-9b1f-${index.toString(16).padStart(12, '0')}`,
    );
    const results = await reader.executeForRecipients(scope, [...accountIds].reverse());
    expect([...results.keys()]).toEqual(accountIds);
    const dialect = new PgDialect();
    expect(execute.mock.calls.map(([statement]) => dialect.sqlToQuery(statement).params)).toEqual([
      [accountIds.slice(0, 250)],
      [accountIds.slice(250)],
    ]);
    expect(where).toHaveBeenCalledTimes(251);
  });

  it('refuses to open recipient reads in a system transaction', async () => {
    const reader = await readActivityPreferencesProvider.useFactory();
    const { scope, execute, select } = systemScope();
    await expect(reader.executeForRecipients(scope, [accountId])).rejects.toThrow(
      'Activity email source preferences require a tenant transaction.',
    );
    expect(execute).not.toHaveBeenCalled();
    expect(select).not.toHaveBeenCalled();
  });
});
