import type { CodeEmailTemplate } from '../../../domain/value-objects/code-email/code-email-template.value-object.js';
import type { OneTimeCode } from '../../../domain/value-objects/code-email/one-time-code.value-object.js';

/**
 * Interface CodeEmailMessage
 *
 * @description
 * What a code e-mail says, before it is rendered.
 */
export interface CodeEmailMessage {
  // #region Properties
  /**
   * Property template
   *
   * @description
   * Template of the e-mail.
   *
   * @type {CodeEmailTemplate}
   * @readonly
   */
  readonly template: CodeEmailTemplate;

  /**
   * Property recipientName
   *
   * @description
   * Name of the account for the greeting, already cleaned; empty to greet without a name.
   *
   * @type {string}
   * @readonly
   */
  readonly recipientName: string;

  /**
   * Property code
   *
   * @description
   * The code the e-mail shows, once, as `482 913`.
   *
   * @type {OneTimeCode}
   * @readonly
   */
  readonly code: OneTimeCode;

  /**
   * Property validityMinutes
   *
   * @description
   * How long the code is valid, in whole minutes.
   *
   * @type {number}
   * @readonly
   */
  readonly validityMinutes: number;
  // #endregion
}
