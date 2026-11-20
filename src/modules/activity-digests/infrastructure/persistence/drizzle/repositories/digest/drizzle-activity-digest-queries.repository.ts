import type { SystemTransactionRunner } from '@cadenway/nest-common/database';
import { and, asc, eq, gt, isNull, lte, sql } from 'drizzle-orm';

import { activityEmailCandidates as candidates } from '../../schemas/digest/activity-email-candidates.schema.js';
import { activityEmailOccurrences as occurrences } from '../../schemas/digest/activity-email-occurrences.schema.js';
import {
  maxActivityDigestBatchSize,
  validateActivityDigestBatchSize,
} from './drizzle-activity-email.repository.js';

/** Reads only opaque identifiers from bounded system queue selections. */
export class DrizzleActivityDigestQueries {
  // #region Constructor
  /** Uses the service-owned system runner for account jobs that span organizations. */
  public constructor(private readonly system: SystemTransactionRunner) {}
  // #endregion

  // #region Methods
  /** Walks unassigned account candidates in stable UUID order without returning selectors. */
  public listPendingRecipients(after: string | null, limit: number): Promise<readonly string[]> {
    validateActivityDigestBatchSize(limit);
    return this.system.run(
      async ({ db }) => {
        const rows = await db
          .selectDistinct({ recipientId: candidates.recipientId })
          .from(candidates)
          .where(
            and(
              isNull(candidates.occurrenceId),
              isNull(candidates.settledAt),
              after === null ? undefined : gt(candidates.recipientId, after),
            ),
          )
          .orderBy(asc(candidates.recipientId))
          .limit(limit);
        return rows.map(({ recipientId }) => recipientId);
      },
      { readOnly: true },
    );
  }

  /** Resolves only the organizations of one due batch before entering their signed scopes. */
  public listDueOrganizations(
    userId: string,
    occurrenceId: string,
    generation: number,
  ): Promise<readonly string[]> {
    const recipientId = userId.toLowerCase();
    return this.system.run(
      async ({ db }) => {
        const rows = await db
          .selectDistinct({ organizationId: candidates.organizationId })
          .from(candidates)
          .innerJoin(
            occurrences,
            and(
              eq(candidates.recipientId, occurrences.recipientId),
              eq(candidates.occurrenceId, occurrences.id),
              eq(candidates.generation, occurrences.generation),
            ),
          )
          .where(
            and(
              eq(candidates.recipientId, recipientId),
              eq(candidates.occurrenceId, occurrenceId),
              eq(candidates.generation, generation),
              eq(occurrences.state, 'scheduled'),
              isNull(candidates.settledAt),
              lte(occurrences.dueAt, sql`clock_timestamp()`),
            ),
          )
          .orderBy(asc(candidates.organizationId))
          .limit(maxActivityDigestBatchSize + 1);
        if (rows.length > maxActivityDigestBatchSize) {
          throw new Error('The activity email occurrence exceeds its organization bound.');
        }
        return rows.map(({ organizationId }) => organizationId);
      },
      { readOnly: true },
    );
  }
  // #endregion
}
