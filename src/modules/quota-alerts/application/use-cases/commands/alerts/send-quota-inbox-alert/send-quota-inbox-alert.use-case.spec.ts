import { describe, expect, it, vi } from 'vitest';

import { SendQuotaInboxAlert } from './send-quota-inbox-alert.use-case.js';

const input = {
  organizationId: 'organization',
  recipientId: 'recipient',
  sourceEventId: 'billing-event',
};

describe('SendQuotaInboxAlert', () => {
  it('rechecks live role on every attempt and writes only the neutral receipt identifiers', async () => {
    const failure = new Error('receipt transaction failed');
    const isEligible = vi.fn().mockResolvedValueOnce(true).mockResolvedValueOnce(false);
    const record = vi.fn().mockRejectedValueOnce(failure);
    const command = new SendQuotaInboxAlert({ isEligible }, record);
    const signal = new AbortController().signal;

    await expect(command.execute(input, signal)).rejects.toBe(failure);
    await command.execute(input, signal);
    expect(isEligible).toHaveBeenCalledTimes(2);
    expect(isEligible).toHaveBeenCalledWith(input.organizationId, input.recipientId, signal);
    expect(isEligible).toHaveBeenCalledBefore(record);
    expect(record).toHaveBeenCalledExactlyOnceWith(input);
  });

  it('defers a receipt when Organization is unavailable', async () => {
    const unavailable = new Error('Organization is unavailable');
    const isEligible = vi.fn().mockRejectedValueOnce(unavailable);
    const record = vi.fn();
    const command = new SendQuotaInboxAlert({ isEligible }, record);
    await expect(command.execute(input, new AbortController().signal)).rejects.toBe(unavailable);
    expect(record).not.toHaveBeenCalled();
  });
});
