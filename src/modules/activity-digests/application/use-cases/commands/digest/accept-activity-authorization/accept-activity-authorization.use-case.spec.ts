import { describe, expect, it, vi } from 'vitest';

import type { ActivityDeliveryStore } from '../../../../ports/outbound/transactions/digest/activity-delivery-store.port.js';
import type { ActivityDeliveryUnitOfWork } from '../../../../ports/outbound/transactions/digest/activity-delivery-unit-of-work.port.js';
import { AcceptActivityAuthorization } from './accept-activity-authorization.use-case.js';

describe('AcceptActivityAuthorization', () => {
  const input = {
    organizationId: 'atelier',
    attemptId: 'request',
    decision: 'permit',
    decidedAt: 90,
    validUntil: 180,
  } as const;

  it('accepts one current correlated decision in its organization', async () => {
    const finishAttempt = vi.fn().mockResolvedValue(undefined);
    const store = {
      lockAttempt: vi.fn().mockResolvedValue({
        id: 'request',
        organizationId: 'atelier',
        expiresAt: 200,
        outcome: 'pending',
      }),
      finishAttempt,
    } as unknown as ActivityDeliveryStore;
    const work: ActivityDeliveryUnitOfWork = {
      runAccount: vi.fn(),
      runTenant: async (_id, run) => run(store),
    };
    expect(await new AcceptActivityAuthorization(work, () => 100).execute(input)).toBe(true);
    expect(finishAttempt).toHaveBeenCalledWith('atelier', 'request', 'permitted', 180);
  });

  it('cannot accept a late decision for a superseded correlation', async () => {
    const finishAttempt = vi.fn();
    const store = {
      lockAttempt: vi.fn().mockResolvedValue({
        id: 'request',
        organizationId: 'atelier',
        expiresAt: 200,
        outcome: 'expired',
      }),
      finishAttempt,
    } as unknown as ActivityDeliveryStore;
    const work: ActivityDeliveryUnitOfWork = {
      runAccount: vi.fn(),
      runTenant: async (_id, run) => run(store),
    };
    expect(await new AcceptActivityAuthorization(work, () => 100).execute(input)).toBe(false);
    expect(finishAttempt).not.toHaveBeenCalled();
  });
});
