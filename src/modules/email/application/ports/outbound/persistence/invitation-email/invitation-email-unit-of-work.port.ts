/**
 * Interface InvitationEmailUnitOfWork
 *
 * @description
 * One transaction of this service's own database, in the organization of the current context: an
 * invitation e-mail belongs to the organization of its `invitation.issued.v1` event. Every call the
 * work makes to `InvitationEmailDeliveries` (but `expireStale`) and `InvitationEmailQueue` joins
 * it, so the delivery, its content, the superseded deliveries and the job are committed together
 * or not at all. Called from the handler of the event, it joins the tenant transaction in which
 * the deduplicator of the kit records the event id and the version of the invitation.
 */
export interface InvitationEmailUnitOfWork {
  // #region Methods
  /**
   * Method run
   *
   * @description
   * Runs the work in one transaction: committed when it resolves, rolled back when it rejects.
   *
   * @param {() => Promise<TResult>} work - The work of the use case.
   * @returns {Promise<TResult>} What the work resolved with, once committed.
   * @throws {Error} When the current context carries no organization.
   */
  run<TResult>(work: () => Promise<TResult>): Promise<TResult>;
  // #endregion
}
