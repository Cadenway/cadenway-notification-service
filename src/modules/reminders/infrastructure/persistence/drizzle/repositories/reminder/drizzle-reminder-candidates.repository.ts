import type { TenantTransactionRunner } from '@cadenway/nest-common/database';

import type { ReminderCandidatesReader } from '../../../../../application/ports/outbound/persistence/reminder/reminder-candidates-reader.port.js';
import type { Reminder } from '../../../../../domain/aggregates/reminder/reminder.aggregate.js';
import { DrizzleReminderRecords } from './drizzle-reminder-records.repository.js';

/** Reads candidate pages and selected records in independent tenant snapshots. */
export class DrizzleReminderCandidatesReader implements ReminderCandidatesReader {
  // #region Constructor
  /** Binds the tenant transaction runner. */
  public constructor(private readonly runner: TenantTransactionRunner) {}
  // #endregion

  // #region Methods
  /** Reads one bounded page plus a single lookahead in a read-only snapshot. */
  public page(input: Parameters<ReminderCandidatesReader['page']>[0]): Promise<{
    readonly generation: string;
    readonly items: readonly Reminder[];
    readonly hasMore: boolean;
  }> {
    if (!Number.isInteger(input.limit) || input.limit < 1 || input.limit > 100)
      throw new RangeError('Reminder page limit must be between 1 and 100.');
    return this.runner.run(
      async (scope) => {
        const records = new DrizzleReminderRecords(scope, input.organizationId.toLowerCase());
        const page = await records.pageAtGeneration(
          input.userId,
          input.expectedGeneration,
          input.limit + 1,
          input.after,
        );
        return {
          generation: page.generation,
          items: page.items.slice(0, input.limit),
          hasMore: page.items.length > input.limit,
        };
      },
      { readOnly: true, isolationLevel: 'repeatable read' },
    );
  }

  /** Rechecks the generation and exact selected pairs in the same read-only snapshot. */
  public selected(
    input: Parameters<ReminderCandidatesReader['selected']>[0],
  ): Promise<readonly Reminder[]> {
    return this.runner.run(
      (scope) =>
        new DrizzleReminderRecords(scope, input.organizationId.toLowerCase()).selectedAtGeneration(
          input.userId,
          input.expectedGeneration,
          input.pairs,
        ),
      { readOnly: true, isolationLevel: 'repeatable read' },
    );
  }
  // #endregion
}
