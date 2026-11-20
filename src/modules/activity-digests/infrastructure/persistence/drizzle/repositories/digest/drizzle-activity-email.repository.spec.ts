import type { TransactionScope } from '@cadenway/nest-common/database';
import type { SQL } from 'drizzle-orm';
import { PgDialect } from 'drizzle-orm/pg-core';
import { describe, expect, it, vi } from 'vitest';

import type { ActivityEmailCandidate } from '../../../../../application/models/digest/activity-email-candidate.model.js';
import { ActivityDigestScope } from '../../transactions/digest/drizzle-activity-digest.unit-of-work.js';
import { DrizzleActivityEmail } from './drizzle-activity-email.repository.js';

const account = '019a7002-3c4d-7e5f-8a6b-7c8d9e0f1a24';
const candidateId = '019a7002-3c4d-7e5f-8a6b-7c8d9e0f1a25';
const batchId = '019a7002-3c4d-7e5f-8a6b-7c8d9e0f1a26';
const tenantId = '019a7002-3c4d-7e5f-8a6b-7c8d9e0f1a27';
const candidate: ActivityEmailCandidate = {
  organizationId: tenantId,
  recipientId: account,
  sourceEventId: candidateId,
  actorUserId: null,
  kind: 'assignment',
  taskKey: 'CAD-482',
  commentId: null,
  status: null,
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
    readPreferences: vi.fn(),
    enqueuePlan: vi.fn().mockResolvedValue(undefined),
    enqueueDelivery: vi.fn().mockResolvedValue(undefined),
  };
  return { repository: new DrizzleActivityEmail(scope, bindings), selectQuery, db, bindings };
}

describe('DrizzleActivityEmail', () => {
  it('verifies the explicit tenant before looking up source preferences or inserting candidates', async () => {
    const { db, bindings } = fixture();
    const transaction = {
      kind: 'tenant',
      organizationId: tenantId,
      db,
    } as unknown as TransactionScope;
    const repository = new DrizzleActivityEmail(new ActivityDigestScope(transaction), bindings);

    expect(() => repository.lockIntakePreferences(batchId, account)).toThrow(
      'Activity email tenant scope does not match',
    );
    await expect(
      repository.insertCandidates(tenantId, [{ ...candidate, organizationId: batchId }]),
    ).rejects.toThrow('Activity email candidate belongs to another organization.');
    expect(bindings.readPreferences).not.toHaveBeenCalled();
    expect(db.insert).not.toHaveBeenCalled();
  });

  it('assigns under the selected account and refuses to overwrite a claimed candidate', async () => {
    const { repository, db } = fixture();
    db.execute.mockResolvedValueOnce({ rowCount: 1 }).mockResolvedValue({ rowCount: 0 });
    const assignments = [{ candidateId, reservation: { id: batchId, generation: 2 } }];

    await expect(repository.assignCandidates(account, assignments)).resolves.toBeUndefined();
    const call = db.execute.mock.calls[0]?.[0];
    if (call === undefined) throw new Error('The candidate was not assigned.');
    const query = new PgDialect().sqlToQuery(call);
    expect(query.params).toEqual([candidateId, batchId, 2, account]);
    expect(query.sql).toContain('candidate.occurrence_id is null');
    expect(query.sql).toContain('candidate.settled_at is null');
    await expect(repository.assignCandidates(account, assignments)).rejects.toThrow(
      'An activity email candidate changed under its account lock.',
    );
  });

  it('refuses a mismatched account and an oversized page before reading its candidates', async () => {
    const { repository, db } = fixture();
    await expect(
      repository.listPendingCandidateIds(batchId, ['assignment'], null, 100),
    ).rejects.toThrow('Activity email account scope does not match');
    await expect(
      repository.listPendingCandidateIds(account, ['assignment'], null, 101),
    ).rejects.toThrow(RangeError);
    expect(db.select).not.toHaveBeenCalled();
  });

  it('bounds the candidate page and returns one lookahead row', async () => {
    const { repository, selectQuery } = fixture();
    selectQuery.limit.mockResolvedValue([{ id: candidateId }]);
    await expect(
      repository.listPendingCandidateIds(account, ['assignment'], null, 100),
    ).resolves.toEqual([candidateId]);
    expect(selectQuery.limit).toHaveBeenCalledExactlyOnceWith(101);
  });
});
