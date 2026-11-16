import { SystemTransactionRunner } from '@cadenway/nest-common/database';
import type { TransactionScope } from '@cadenway/nest-common/database';
import { JobProducer } from '@cadenway/nest-jobs/runtime';
import { Injectable } from '@nestjs/common';
import { SEND_CODE_EMAIL_QUEUE } from '../../../../../../config/job-queues.js';
import type { CodeEmailQueue } from '../../../../application/ports/outbound/jobs/code-email/code-email-queue.port.js';

/**
 * Interface SendCodeEmailJob
 *
 * @description
 * Payload of a job of `email.send-code`: the id of the delivery, nothing else. The code and the
 * address stay in `pending_code_emails`, so the rows of pg-boss, kept an hour after the job
 * finished and a day as dead letters, hold neither.
 */
export interface SendCodeEmailJob {
  // #region Properties
  /**
   * Property deliveryId
   *
   * @description
   * Id of the delivery in `code_email_deliveries`.
   *
   * @type {string}
   * @readonly
   */
  readonly deliveryId: string;
  // #endregion
}

/**
 * Class JobsCodeEmailQueue
 *
 * @description
 * `CodeEmailQueue` on the durable jobs of `@cadenway/nest-jobs` (pg-boss in this service's own
 * database). The job is inserted through the client of the system transaction already open, so it
 * exists if and only if the delivery is committed. Its occurrence key is the id of the delivery:
 * enqueueing the same delivery twice inserts nothing.
 */
@Injectable()
export class JobsCodeEmailQueue implements CodeEmailQueue {
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
   * The transactional job submission capability.
   *
   * @type {JobProducer}
   * @readonly
   */
  private readonly jobs: JobProducer;
  // #endregion

  // #region Constructor
  /**
   * Constructor
   *
   * @description
   * Receives the system transaction runner and the job producer.
   *
   * @param {SystemTransactionRunner} system - The system transaction runner.
   * @param {JobProducer} jobs - The job producer.
   * @constructor
   */
  public constructor(system: SystemTransactionRunner, jobs: JobProducer) {
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
    const job: SendCodeEmailJob = { deliveryId };
    await this.system.run(async (tx: TransactionScope): Promise<void> => {
      await this.jobs.enqueue(tx, SEND_CODE_EMAIL_QUEUE, job, { occurrenceKey: deliveryId });
    });
  }
  // #endregion
}
