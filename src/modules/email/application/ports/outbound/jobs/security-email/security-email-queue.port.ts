/**
 * Interface SecurityEmailQueue
 *
 * @description
 * The durable queue of the security e-mails: one job per e-mail, enqueued in the transaction of the
 * delivery so that the job exists if and only if the delivery is committed. The job carries the id
 * of the delivery only, which is also its idempotency key: enqueueing the same delivery twice adds
 * nothing.
 */
export interface SecurityEmailQueue {
  // #region Methods
  /**
   * Method enqueue
   *
   * @description
   * Enqueues the sending of a delivery, inside the current transaction of the unit of work.
   *
   * @param {string} deliveryId - Id of the delivery in the send log.
   * @returns {Promise<void>} Settles once the job is inserted, not sent.
   */
  enqueue(deliveryId: string): Promise<void>;
  // #endregion
}
