import { TenantTransactionRunner } from '@cadenway/nest-common/database';
import { Injectable } from '@nestjs/common';
import type { InvitationEmailUnitOfWork } from '../../../../../application/ports/outbound/persistence/invitation-email/invitation-email-unit-of-work.port.js';

/**
 * Class TenantInvitationEmailUnitOfWork
 *
 * @description
 * `InvitationEmailUnitOfWork` on the tenant transaction runner of the kit, in the organization of
 * the current context: the organization of the `invitation.issued.v1` event, set by the kit around
 * its handler, or the organization of the job, set by the job handler. Called from the handler of
 * the event, it joins the tenant transaction of the deduplicator, so the processed id, the claimed
 * version, the delivery, its content and its job commit together.
 */
@Injectable()
export class TenantInvitationEmailUnitOfWork implements InvitationEmailUnitOfWork {
  // #region Properties
  /**
   * Property tenant
   *
   * @description
   * The tenant transaction runner of the kit.
   *
   * @type {TenantTransactionRunner}
   * @readonly
   */
  private readonly tenant: TenantTransactionRunner;
  // #endregion

  // #region Constructor
  /**
   * Constructor
   *
   * @description
   * Receives the tenant transaction runner of `DatabaseModule`.
   *
   * @param {TenantTransactionRunner} tenant - The tenant transaction runner.
   * @constructor
   */
  public constructor(tenant: TenantTransactionRunner) {
    this.tenant = tenant;
  }
  // #endregion

  // #region Methods
  /**
   * Method run
   *
   * @description
   * Runs the work in a tenant transaction of the organization of the context, or in the one
   * already open.
   *
   * @param {() => Promise<TResult>} work - The work of the use case.
   * @returns {Promise<TResult>} What the work resolved with, once committed.
   * @throws {Error} When the context carries no organization.
   */
  public async run<TResult>(work: () => Promise<TResult>): Promise<TResult> {
    return this.tenant.run(() => work());
  }
  // #endregion
}
