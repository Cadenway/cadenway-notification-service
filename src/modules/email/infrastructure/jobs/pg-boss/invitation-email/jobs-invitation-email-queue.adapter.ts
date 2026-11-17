import { TenantTransactionRunner } from '@cadenway/nest-common/database';
import type { TransactionScope } from '@cadenway/nest-common/database';
import { JobsService } from '@cadenway/nest-jobs';
import { Injectable } from '@nestjs/common';
import { SEND_INVITATION_EMAIL_QUEUE } from '../../../../../../config/job-queues.js';
import type { InvitationEmailQueue } from '../../../../application/ports/outbound/jobs/invitation-email/invitation-email-queue.port.js';

/**
 * Interface SendInvitationEmailJob
 *
 * @description
 * Payload of a job of `email.send-invitation`: the id of the delivery, nothing else. The address
 * and the names stay in `pending_invitation_emails`, so the rows of pg-boss, kept an hour after
 * the job finished and a day as dead letters, hold none of them. The organization travels in the
 * envelope of the kit, from the tenant transaction that enqueued the job.
 */
export interface SendInvitationEmailJob {
  // #region Properties
  /**
   * Property deliveryId
   *
   * @description
   * Id of the delivery in `invitation_email_deliveries`.
   *
   * @type {string}
   * @readonly
   */
  readonly deliveryId: string;
  // #endregion
}

/**
 * Class JobsInvitationEmailQueue
 *
 * @description
 * `InvitationEmailQueue` on the durable jobs of `@cadenway/nest-jobs` (pg-boss in this service's
 * own database). The job is inserted through the client of the tenant transaction already open,
 * so it exists if and only if the delivery is committed, and it records the organization of that
 * transaction, which its handler works in. Its occurrence key is the id of the delivery: enqueueing
 * the same delivery twice inserts nothing.
 */
@Injectable()
export class JobsInvitationEmailQueue implements InvitationEmailQueue {
  // #region Properties
  /**
   * Property tenant
   *
   * @description
   * The tenant transaction runner of the kit, joined to reach the open transaction.
   *
   * @type {TenantTransactionRunner}
   * @readonly
   */
  private readonly tenant: TenantTransactionRunner;

  /**
   * Property jobs
   *
   * @description
   * The jobs of `JobsModule`.
   *
   * @type {JobsService}
   * @readonly
   */
  private readonly jobs: JobsService;
  // #endregion

  // #region Constructor
  /**
   * Constructor
   *
   * @description
   * Receives the tenant transaction runner and the jobs service.
   *
   * @param {TenantTransactionRunner} tenant - The tenant transaction runner.
   * @param {JobsService} jobs - The jobs service.
   * @constructor
   */
  public constructor(tenant: TenantTransactionRunner, jobs: JobsService) {
    this.tenant = tenant;
    this.jobs = jobs;
  }
  // #endregion

  // #region Methods
  /**
   * Method enqueue
   *
   * @description
   * Inserts the job of a delivery in the open transaction.
   *
   * @param {string} deliveryId - Id of the delivery.
   * @returns {Promise<void>} Settles once the job is inserted.
   */
  public async enqueue(deliveryId: string): Promise<void> {
    const job: SendInvitationEmailJob = { deliveryId };
    await this.tenant.run(async (tx: TransactionScope): Promise<void> => {
      await this.jobs.enqueue(tx, SEND_INVITATION_EMAIL_QUEUE, job, { occurrenceKey: deliveryId });
    });
  }
  // #endregion
}
