import { describe, expect, it, vi } from 'vitest';

import type { ActivityEmailStore } from '../../../../ports/outbound/transactions/digest/activity-email-store.port.js';
import type { ActivityEmailUnitOfWork } from '../../../../ports/outbound/transactions/digest/activity-email-unit-of-work.port.js';
import { PlanActivityEmail } from './plan-activity-email.use-case.js';

describe('PlanActivityEmail', () => {
  it('plans in the account time zone and enqueues under the locked preference snapshot', async () => {
    const preferences = {
      version: 2,
      cadence: 'daily',
      enabled: {
        assignment: true,
        comment: false,
        mention: true,
        'status-change': false,
        approval: true,
        access: true,
      },
    } as const;
    const schedule = vi.fn().mockResolvedValue(1);
    const store = {
      lockPreferences: vi.fn().mockResolvedValue(preferences),
      schedule,
    } as unknown as ActivityEmailStore;
    const work: ActivityEmailUnitOfWork = {
      runTenant: vi.fn(),
      runAccount: async (_id, run) => run(store),
    };
    const recipients = {
      findCurrent: vi.fn().mockResolvedValue({
        userId: 'ines',
        email: 'ines@example.test',
        language: 'fr',
        timeZone: 'Europe/Paris',
        version: 3,
      }),
    };

    expect(
      await new PlanActivityEmail(recipients, work).execute({
        userId: 'ines',
        notBeforeMs: Date.parse('2026-03-27T08:00:00Z'),
      }),
    ).toBe(1);
    expect(schedule).toHaveBeenCalledWith(
      'ines',
      preferences,
      expect.objectContaining({ localDate: '2026-03-27', profileVersion: 3 }),
      100,
    );
  });

  it('does not open a transaction for an unverified or deleted recipient', async () => {
    const runAccount = vi.fn();
    const work: ActivityEmailUnitOfWork = { runTenant: vi.fn(), runAccount };
    const recipients = { findCurrent: vi.fn().mockResolvedValue(null) };
    expect(
      await new PlanActivityEmail(recipients, work).execute({ userId: 'ines', notBeforeMs: 1 }),
    ).toBe(0);
    expect(runAccount).not.toHaveBeenCalled();
  });
});
