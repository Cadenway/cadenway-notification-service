import type { TransactionScope } from '@cadenway/nest-common/database';
import type { SQL } from 'drizzle-orm';
import { PgDialect } from 'drizzle-orm/pg-core';
import { describe, expect, it, vi } from 'vitest';

import type { ActivityEmailPreferences } from '../../../../../application/models/digest/activity-email-preferences.model.js';
import type { ActivityEmailOccurrence } from '../../../../../domain/value-objects/digest/activity-email-occurrence.value-object.js';
import { ActivityDigestScope } from '../../transactions/digest/drizzle-activity-digest.unit-of-work.js';
import { DrizzleActivityEmail } from './drizzle-activity-email.repository.js';

const account = '019a7002-3c4d-7e5f-8a6b-7c8d9e0f1a24';
const candidateId = '019a7002-3c4d-7e5f-8a6b-7c8d9e0f1a25';
const batchId = '019a7002-3c4d-7e5f-8a6b-7c8d9e0f1a26';
const tenantId = '019a7002-3c4d-7e5f-8a6b-7c8d9e0f1a27';

const preferences: ActivityEmailPreferences = {
  version: 1,
  cadence: 'daily',
  enabled: {
    assignment: true,
    comment: true,
    mention: true,
    'status-change': false,
    approval: true,
    access: true,
  },
};

const digest: ActivityEmailOccurrence = {
  cadence: 'daily',
  dueAtMs: Date.parse('2026-11-23T08:00:00Z'),
  localDate: '2026-11-23',
  timeZone: 'Europe/Paris',
  profileVersion: 1,
};

function fixture() {
  const selectQuery = {
    from: vi.fn().mockReturnThis(),
    where: vi.fn().mockReturnThis(),
    orderBy: vi.fn().mockReturnThis(),
    limit: vi.fn(),
  };
  const db = {
    select: vi.fn(() => selectQuery),
    insert: vi.fn(),
    execute: vi.fn<(query: SQL) => Promise<{ readonly rowCount: number }>>(),
  };
  const scope = new ActivityDigestScope(
    { kind: 'system', db } as unknown as TransactionScope,
    account,
  );
  const bindings = {
    readPreferences: vi.fn().mockResolvedValue(preferences),
    enqueuePlan: vi.fn().mockResolvedValue(undefined),
    enqueueDelivery: vi.fn().mockResolvedValue(undefined),
  };
  return { repository: new DrizzleActivityEmail(scope, bindings), selectQuery, db, bindings };
}

describe('DrizzleActivityEmail', () => {
  it.each([
    { cadence: 'never', kind: 'assignment' },
    { cadence: 'daily', kind: 'status-change' },
  ] as const)(
    'does not persist activity blocked at ingestion by $cadence or $kind',
    async ({ cadence, kind }) => {
      const { db, bindings } = fixture();
      const transaction = {
        kind: 'tenant',
        organizationId: tenantId,
        db,
      } as unknown as TransactionScope;
      bindings.readPreferences.mockResolvedValue({ ...preferences, cadence });
      const repository = new DrizzleActivityEmail(new ActivityDigestScope(transaction), bindings);
      await expect(
        repository.stage(tenantId, [
          {
            organizationId: tenantId,
            recipientId: account,
            sourceEventId: candidateId,
            actorUserId: null,
            kind,
            taskKey: 'CAD-482',
            commentId: null,
            status: null,
          },
        ]),
      ).resolves.toBe(0);
      expect(bindings.readPreferences).toHaveBeenCalledExactlyOnceWith(transaction, account);
      expect(db.insert).not.toHaveBeenCalled();
      expect(bindings.enqueuePlan).not.toHaveBeenCalled();
    },
  );

  it('appends a later tenant candidate to an open digest without enqueueing a second send', async () => {
    const { repository, selectQuery, db, bindings } = fixture();
    selectQuery.limit
      .mockResolvedValueOnce([{ id: candidateId }])
      .mockResolvedValueOnce([{ id: batchId, generation: 2 }])
      .mockResolvedValueOnce([{ id: 'already-reserved' }]);
    db.execute.mockResolvedValue({ rowCount: 1 });

    await expect(repository.schedule(account, preferences, digest, 100)).resolves.toBe(0);
    const call = db.execute.mock.calls[0]?.[0];
    if (call === undefined) throw new Error('The candidate was not assigned.');
    const query = new PgDialect().sqlToQuery(call);
    expect(query.params).toEqual([candidateId, batchId, 2, account]);
    expect(query.sql).toContain('candidate.occurrence_id is null');
    expect(db.insert).not.toHaveBeenCalled();
    expect(bindings.enqueueDelivery).not.toHaveBeenCalled();
  });

  it('refuses a different account and an oversized page before reading its candidates', async () => {
    const { repository, db } = fixture();
    await expect(repository.schedule(batchId, preferences, digest, 100)).rejects.toThrow(
      'Activity email account scope does not match',
    );
    await expect(repository.schedule(account, preferences, digest, 101)).rejects.toThrow(
      RangeError,
    );
    expect(db.select).not.toHaveBeenCalled();
  });
});
