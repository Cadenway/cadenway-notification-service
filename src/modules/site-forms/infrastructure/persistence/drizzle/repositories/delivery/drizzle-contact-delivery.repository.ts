import type { SystemTransactionRunner } from '@cadenway/nest-common/database';
import { and, eq, sql } from 'drizzle-orm';

import type { ContactDeliveries } from '../../../../../application/ports/outbound/persistence/delivery/contact-deliveries.port.js';
import { ContactSubmission } from '../../../../../domain/value-objects/forms/contact-submission.value-object.js';
import { siteContactSubmissions } from '../../schemas/forms/site-contact.schema.js';

/** Restricts delivery reads and transitions to the identified submission in system scope. */
export class DrizzleContactDeliveryRepository implements ContactDeliveries {
  // #region Constructor
  /** Uses the system runner required by the global contact table's RLS policy. */
  public constructor(private readonly system: SystemTransactionRunner) {}
  // #endregion

  // #region Methods
  /** Reads the pending message by the job's submission ID and restores its validated form. */
  public loadPending(submissionId: string): Promise<ContactSubmission | null> {
    return this.system.run(async ({ db }) => {
      const [row] = await db
        .select({
          replyTo: siteContactSubmissions.replyTo,
          subject: siteContactSubmissions.subject,
          message: siteContactSubmissions.message,
        })
        .from(siteContactSubmissions)
        .where(
          and(
            eq(siteContactSubmissions.id, submissionId),
            eq(siteContactSubmissions.status, 'pending'),
          ),
        )
        .limit(1);

      return row === undefined
        ? null
        : ContactSubmission.of({
            email: row.replyTo,
            subject: row.subject,
            message: row.message.text,
          });
    });
  }

  /** Settles the delivery only while its row is pending. */
  public settlePending(submissionId: string, status: 'sent' | 'failed'): Promise<void> {
    return this.system.run(async ({ db }) => {
      await db
        .update(siteContactSubmissions)
        .set({ status, updatedAt: sql`clock_timestamp()` })
        .where(
          and(
            eq(siteContactSubmissions.id, submissionId),
            eq(siteContactSubmissions.status, 'pending'),
          ),
        );
    });
  }
  // #endregion
}
