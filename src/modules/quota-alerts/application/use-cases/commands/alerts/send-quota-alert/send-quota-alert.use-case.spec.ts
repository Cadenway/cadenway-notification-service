import { describe, expect, it, vi } from 'vitest';

import type { SendQuotaAlertInput } from './send-quota-alert.input.js';
import { SendQuotaAlert } from './send-quota-alert.use-case.js';

const input: SendQuotaAlertInput = {
  organizationId: 'organization',
  userId: 'recipient',
  occurrenceId: 'job',
  alert: {
    eventId: 'billing-event',
    metric: 'storage',
    thresholdPercent: 80,
    used: 1_600_000_000,
    limit: 2_000_000_000,
  },
};

/** Binds lightweight copies of each owner port for one delivery scenario. */
function setup() {
  const recipients = {
    list: vi.fn(),
    isEligible: vi.fn().mockResolvedValue(true),
  };
  const delivery = {
    isEnabled: vi.fn().mockResolvedValue(true),
    resolve: vi.fn().mockResolvedValue('current@example.test'),
    send: vi.fn().mockResolvedValue(undefined),
  };
  const controller = new AbortController();
  const command = new SendQuotaAlert(recipients, delivery);
  return {
    recipients,
    delivery,
    signal: controller.signal,
    abort: () => {
      controller.abort();
    },
    execute: () => command.execute(input, controller.signal),
  };
}

describe('SendQuotaAlert', () => {
  it('rechecks authority as the last lookup before sending to the current verified address', async () => {
    const { delivery, recipients, signal, execute } = setup();
    await execute();
    expect(delivery.isEnabled).toHaveBeenCalledBefore(delivery.resolve);
    expect(delivery.resolve).toHaveBeenCalledWith(input.userId, signal);
    expect(delivery.resolve).toHaveBeenCalledBefore(recipients.isEligible);
    expect(recipients.isEligible).toHaveBeenCalledWith(input.organizationId, input.userId, signal);
    expect(recipients.isEligible).toHaveBeenCalledBefore(delivery.send);
    expect(delivery.send).toHaveBeenCalledWith(
      input.occurrenceId,
      'current@example.test',
      input.alert,
    );
  });

  it('skips an account that disabled quota email or whose verified address is gone', async () => {
    const { delivery, recipients, execute } = setup();
    delivery.isEnabled.mockResolvedValueOnce(false);
    await execute();
    expect(delivery.resolve).not.toHaveBeenCalled();
    delivery.resolve.mockResolvedValueOnce(null);
    await execute();
    expect(recipients.isEligible).not.toHaveBeenCalled();
    expect(delivery.send).not.toHaveBeenCalled();
  });

  it('defers on unavailable authority and repeats both current lookups before retrying', async () => {
    const { delivery, recipients, execute } = setup();
    const unavailable = new Error('unavailable authority');
    recipients.isEligible.mockRejectedValueOnce(unavailable).mockResolvedValueOnce(false);
    delivery.resolve.mockResolvedValueOnce('stale@example.test');
    await expect(execute()).rejects.toBe(unavailable);
    await execute();
    expect(delivery.resolve).toHaveBeenCalledTimes(2);
    expect(recipients.isEligible).toHaveBeenCalledTimes(2);
    expect(delivery.send).not.toHaveBeenCalled();
  });

  it('skips submission when the job expires during the final lookup', async () => {
    const { delivery, recipients, abort, execute } = setup();
    recipients.isEligible.mockImplementation(() => {
      abort();
      return Promise.resolve(true);
    });
    await expect(execute()).rejects.toThrow();
    expect(delivery.send).not.toHaveBeenCalled();
  });
});
