import { SystemTransactionRunner } from '@cadenway/nest-common/database';
import { Injectable } from '@nestjs/common';
import type { InvitationEmailSweepUnitOfWork } from '../../../../../application/ports/outbound/persistence/invitation-email/invitation-email-sweep-unit-of-work.port.js';

/**
 * Class SystemInvitationEmailSweepUnitOfWork
 *
 * @description
 * `InvitationEmailSweepUnitOfWork` on the system transaction runner of the kit: the scheduled
 * sweep has no organization and settles the expired invitation e-mails of every organization.
 */
@Injectable()
export class SystemInvitationEmailSweepUnitOfWork implements InvitationEmailSweepUnitOfWork {
  // #region Properties
  /**
   * Property system
   *
   * @description
   * The system transaction runner of the kit.
   *
   * @type {SystemTransactionRunner}
   * @readonly
   */
  private readonly system: SystemTransactionRunner;
  // #endregion

  // #region Constructor
  /**
   * Constructor
   *
   * @description
   * Receives the system transaction runner of `DatabaseModule`.
   *
   * @param {SystemTransactionRunner} system - The system transaction runner.
   * @constructor
   */
  public constructor(system: SystemTransactionRunner) {
    this.system = system;
  }
  // #endregion

  // #region Methods
  /**
   * Method run
   *
   * @description
   * Runs the work in a system transaction, or in the one already open.
   *
   * @param {() => Promise<TResult>} work - The work of the use case.
   * @returns {Promise<TResult>} What the work resolved with, once committed.
   */
  public async run<TResult>(work: () => Promise<TResult>): Promise<TResult> {
    return this.system.run(() => work());
  }
  // #endregion
}
