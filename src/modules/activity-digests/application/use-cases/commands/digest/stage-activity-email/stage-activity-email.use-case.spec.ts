import { describe, expect, it, vi } from 'vitest';

import type { ActivityEmailStore } from '../../../../ports/outbound/transactions/digest/activity-email-store.port.js';
import type { ActivityEmailUnitOfWork } from '../../../../ports/outbound/transactions/digest/activity-email-unit-of-work.port.js';
import { StageActivityEmail } from './stage-activity-email.use-case.js';

describe('StageActivityEmail', () => {
  it('stages the highest-priority audience once per account without an Inbox lookup', async () => {
    const stage = vi.fn().mockResolvedValue(1);
    const store = { stage } as unknown as ActivityEmailStore;
    const work: ActivityEmailUnitOfWork = {
      runTenant: async (_organizationId, run) => run(store),
      runAccount: vi.fn(),
    };
    const result = await new StageActivityEmail(work).execute({
      source: {
        organizationId: 'atelier',
        sourceEventId: 'event',
        actorUserId: 'CAMILLE',
        taskKey: 'CAD-482',
        commentId: null,
        status: null,
      },
      audiences: [
        { kind: 'mention', recipientIds: ['CAMILLE', 'INES'] },
        { kind: 'assignment', recipientIds: ['ines'] },
      ],
    });

    expect(result).toBe(1);
    expect(stage).toHaveBeenCalledOnce();
    expect(stage).toHaveBeenCalledWith('atelier', [
      expect.objectContaining({ recipientId: 'ines', kind: 'mention' }),
    ]);
  });
});
