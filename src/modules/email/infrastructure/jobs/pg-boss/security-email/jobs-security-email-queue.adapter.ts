import { SystemTransactionRunner } from '@cadenway/nest-common/database';
import type { TransactionScope } from '@cadenway/nest-common/database';
import { JobsService } from '@cadenway/nest-jobs';
import { Injectable } from '@nestjs/common';
import { SEND_SECURITY_EMAIL_QUEUE } from '../../../../../../config/job-queues.js';
import type { SecurityEmailQueue } from '../../../../application/ports/outbound/jobs/security-email/security-email-queue.port.js';

/**
 * Interface SendSecurityEmailJob
 *
 * @description
 * Payload of a job of `email.send-security`: the id of the delivery, nothing else. The address, the
 * device and the reset token stay in `pending_security_emails`, so the rows of pg-boss, kept an
 * hour after the job finished and a day as dead letters, hold none of them.
 */
export interface SendSecurityEmailJob {
  // #region Properties
  /**
   * Property deliveryId
   *
   * @description
   * Id of the delivery in `security_email_deliveries`.
   *
   * @type {string}
   * @readonly
   */
  readonly deliveryId: string;
  // #endregion
}

/**
 * Class JobsSecurityEmailQueue
 *
 * @description
 * `SecurityEmailQueue` on the durable jobs of `@cadenway/nest-jobs` (pg-boss in this service's own
 * database). The job is inserted through the client of the system transaction already open, so it
 * exists if and only if the delivery is committed. Its occurrence key is the id of the delivery:
 * enqueueing the same delivery twice inserts nothing.
 */
@Injectable()
export class JobsSecurityEmailQueue implements SecurityEmailQueue {
  // #region Properties
  /**
   * Property system
   *
   * @description
   * The system transaction runner of the kit, joined to reach the open transaction.
   *
   * @type {SystemTransactionRunner}
   * @readonly
   */
  private readonly system: SystemTransactionRunner;

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
   * Receives the system transaction runner and the jobs service.
   *
   * @param {SystemTransactionRunner} system - The system transaction runner.
   * @param {JobsService} jobs - The jobs service.
   * @constructor
   */
  public constructor(system: SystemTransactionRunner, jobs: JobsService) {
    this.system = system;
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
    const job: SendSecurityEmailJob = { deliveryId };
    await this.system.run(async (tx: TransactionScope): Promise<void> => {
      await this.jobs.enqueue(tx, SEND_SECURITY_EMAIL_QUEUE, job, { occurrenceKey: deliveryId });
    });
  }
  // #endregion
}
