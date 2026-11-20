import type { TransactionScope } from '@cadenway/nest-common/database';
import { describe, expect, it, vi } from 'vitest';

import { ActivityDigestScope } from '../../transactions/digest/drizzle-activity-digest.unit-of-work.js';
import { DrizzleActivityDelivery } from './drizzle-activity-delivery.repository.js';

const organizationId = '019a7002-3c4d-7e5f-8a6b-7c8d9e0f1a24';
const anotherTenant = '019a7002-3c4d-7e5f-8a6b-7c8d9e0f1a25';
const correlation = '019a7002-3c4d-7e5f-8a6b-7c8d9e0f1a26';

describe('DrizzleActivityDelivery', () => {
  it('rejects a Task decision in the wrong tenant transaction before selecting a correlation', async () => {
    const db = { select: vi.fn(), update: vi.fn() };
    const scope = new ActivityDigestScope({
      kind: 'tenant',
      organizationId,
      db,
    } as unknown as TransactionScope);
    const store = new DrizzleActivityDelivery(scope, {
      readPreferences: vi.fn(),
      writeAuthorization: vi.fn(),
      enqueuePlan: vi.fn(),
    });

    await expect(store.lockAttempt(anotherTenant, correlation)).rejects.toThrow(
      'Activity email tenant scope does not match',
    );
    await expect(
      store.finishAttempt(anotherTenant, correlation, 'denied', Date.now()),
    ).rejects.toThrow('Activity email tenant scope does not match');
    await expect(
      store.listAuthorizationCandidates(anotherTenant, correlation, correlation, 1),
    ).rejects.toThrow('Activity email tenant scope does not match');
    await expect(
      store.reserveAuthorizationAttempts(anotherTenant, correlation, correlation, 1, 100, [
        correlation,
      ]),
    ).rejects.toThrow('Activity email tenant scope does not match');
    expect(db.select).not.toHaveBeenCalled();
    expect(db.update).not.toHaveBeenCalled();
  });
});
