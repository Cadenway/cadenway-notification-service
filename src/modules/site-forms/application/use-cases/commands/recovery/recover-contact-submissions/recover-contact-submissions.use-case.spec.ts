import { describe, expect, it, vi } from 'vitest';

import type { ContactRecoveryTransaction } from '../../../../ports/outbound/transactions/recovery/contact-recovery-transaction.port.js';
import type { ContactRecoveryUnitOfWork } from '../../../../ports/outbound/transactions/recovery/contact-recovery-unit-of-work.port.js';
import { RecoverContactSubmissions } from './recover-contact-submissions.use-case.js';

function setup(deliveryEnabled: boolean) {
  const prune = vi
    .fn<ContactRecoveryTransaction['pruneExpiredReceipts']>()
    .mockResolvedValue(undefined);
  const requeue = vi
    .fn<ContactRecoveryTransaction['requeueStaleSubmissions']>()
    .mockResolvedValue(undefined);
  const pruneSubmissions = vi
    .fn<ContactRecoveryTransaction['pruneExpiredSubmissions']>()
    .mockResolvedValue(undefined);
  const run = vi.fn<ContactRecoveryUnitOfWork['run']>((work) =>
    work({
      pruneExpiredReceipts: prune,
      pruneExpiredSubmissions: pruneSubmissions,
      requeueStaleSubmissions: requeue,
    }),
  );
  return {
    prune,
    pruneSubmissions,
    requeue,
    run,
    recover: new RecoverContactSubmissions({ run }, deliveryEnabled),
  };
}

describe('Contact submission recovery', () => {
  it('bounds receipt expiry and stale delivery recovery in separate transactions', async () => {
    const { prune, pruneSubmissions, recover, requeue, run } = setup(true);
    await recover.execute();

    expect(run).toHaveBeenCalledTimes(3);
    expect(prune).toHaveBeenCalledExactlyOnceWith(50);
    expect(pruneSubmissions).toHaveBeenCalledExactlyOnceWith(50);
    expect(requeue).toHaveBeenCalledExactlyOnceWith(50, 25);
  });

  it('still expires receipts while support delivery is disabled', async () => {
    const { prune, pruneSubmissions, recover, requeue, run } = setup(false);
    await recover.execute();

    expect(run).toHaveBeenCalledTimes(2);
    expect(prune).toHaveBeenCalledExactlyOnceWith(50);
    expect(pruneSubmissions).toHaveBeenCalledExactlyOnceWith(50);
    expect(requeue).not.toHaveBeenCalled();
  });
});
