/**
 * Interface InvitationEmailSweepUnitOfWork
 *
 * @description
 * One transaction of this service's own database across organizations, for the scheduled sweep of
 * the invitation e-mails: a scheduled job carries no organization, and the sweep settles the
 * expired deliveries of every organization at once. Each of its statements names the rows it
 * means (`InvitationEmailDeliveries.expireStale`).
 */
export interface InvitationEmailSweepUnitOfWork {
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
