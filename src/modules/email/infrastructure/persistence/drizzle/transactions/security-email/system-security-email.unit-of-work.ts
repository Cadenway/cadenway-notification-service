import { SystemTransactionRunner } from '@cadenway/nest-common/database';
import { Injectable } from '@nestjs/common';
import type { SecurityEmailUnitOfWork } from '../../../../../application/ports/outbound/persistence/security-email/security-email-unit-of-work.port.js';

/**
 * Class SystemSecurityEmailUnitOfWork
 *
 * @description
 * `SecurityEmailUnitOfWork` on the system transaction runner of the kit: a security e-mail belongs
 * to no organization. Called from the handler of an identity-service event, whose event has no
 * organization, it joins the system transaction of the deduplicator, so the processed id of the
 * event, the delivery, its content and its job commit together.
 */
@Injectable()
export class SystemSecurityEmailUnitOfWork implements SecurityEmailUnitOfWork {
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
