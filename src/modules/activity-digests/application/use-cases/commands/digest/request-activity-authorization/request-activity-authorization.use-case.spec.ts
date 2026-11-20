import { describe, expect, it, vi } from 'vitest';

import type { ActivityDeliveryStore } from '../../../../ports/outbound/transactions/digest/activity-delivery-store.port.js';
import type { ActivityDeliveryUnitOfWork } from '../../../../ports/outbound/transactions/digest/activity-delivery-unit-of-work.port.js';
import { RequestActivityAuthorization } from './request-activity-authorization.use-case.js';

describe('RequestActivityAuthorization', () => {
  it('writes requests only through the originating tenant transaction', async () => {
    const requestAuthorization = vi.fn().mockResolvedValue(undefined);
    const store = { requestAuthorization } as unknown as ActivityDeliveryStore;
    const runTenant = vi.fn(
      async (_id: string, run: (value: ActivityDeliveryStore) => Promise<unknown>) => run(store),
    );
    const work = { runTenant, runAccount: vi.fn() } as unknown as ActivityDeliveryUnitOfWork;
    const input = {
      organizationId: 'atelier',
      userId: 'ines',
      occurrenceId: 'batch',
      generation: 2,
      expiresAt: 200,
    };

    await expect(new RequestActivityAuthorization(work, () => 100).execute(input)).resolves.toBe(
      true,
    );
    expect(runTenant).toHaveBeenCalledWith('atelier', expect.any(Function));
    expect(requestAuthorization).toHaveBeenCalledWith('atelier', 'ines', 'batch', 2, 200);
  });

  it('fails the transaction if its authorization deadline expires during staging', async () => {
    const requestAuthorization = vi.fn().mockResolvedValue(undefined);
    const store = { requestAuthorization } as unknown as ActivityDeliveryStore;
    const work: ActivityDeliveryUnitOfWork = {
      runAccount: vi.fn(),
      runTenant: async (_id, run) => run(store),
    };
    const clock = vi.fn().mockReturnValueOnce(100).mockReturnValueOnce(200);
    await expect(
      new RequestActivityAuthorization(work, clock).execute({
        organizationId: 'atelier',
        userId: 'ines',
        occurrenceId: 'batch',
        generation: 2,
        expiresAt: 200,
      }),
    ).rejects.toThrow('expired');
  });
});
