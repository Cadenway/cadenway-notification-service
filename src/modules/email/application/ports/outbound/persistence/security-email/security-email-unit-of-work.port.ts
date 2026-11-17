/**
 * Interface SecurityEmailUnitOfWork
 *
 * @description
 * One transaction of this service's own database, outside any organization: a security e-mail
 * belongs to an account, and the identity-service events carry no organization. Every call the work
 * makes to `SecurityEmailDeliveries` and `SecurityEmailQueue` joins it, so the delivery, its content
 * and its job are committed together or not at all. Called from the handler of an event, it joins
 * the transaction in which the deduplicator of the kit records the event id.
 */
export interface SecurityEmailUnitOfWork {
  // #region Methods
  /**
   * Method run
   *
   * @description
   * Runs the work in one transaction: committed when it resolves, rolled back when it rejects.
   *
   * @param {() => Promise<TResult>} work - The work of the use case.
   * @returns {Promise<TResult>} What the work resolved with, once committed.
   */
  run<TResult>(work: () => Promise<TResult>): Promise<TResult>;
  // #endregion
}
