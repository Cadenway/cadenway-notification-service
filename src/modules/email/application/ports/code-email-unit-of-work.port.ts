/**
 * Interface CodeEmailUnitOfWork
 *
 * @description
 * One transaction of this service's own database, outside any organization: a code e-mail
 * belongs to an account, and `one-time-code.issued.v1` carries no organization. Every call the
 * work makes to `CodeEmailDeliveries` and `CodeEmailQueue` joins it, so the delivery, its content
 * and its job are committed together or not at all. Called from the handler of the event, it joins
 * the transaction in which the deduplicator of the kit records the event id.
 */
export interface CodeEmailUnitOfWork {
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

/**
 * Constant CODE_EMAIL_UNIT_OF_WORK
 *
 * @description
 * Injection token of the `CodeEmailUnitOfWork`.
 *
 * @type {unique symbol}
 */
export const CODE_EMAIL_UNIT_OF_WORK: unique symbol = Symbol('CodeEmailUnitOfWork');
