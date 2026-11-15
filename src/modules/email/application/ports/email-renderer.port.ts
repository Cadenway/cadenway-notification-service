import type { CodeEmailTemplate } from '../../domain/code-email.js';
import type { OneTimeCode } from '../../domain/one-time-code.js';

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

/**
 * Interface RenderedEmail
 *
 * @description
 * An e-mail ready to send: its subject, its HTML part and its text part, written together.
 */
export interface RenderedEmail {
  // #region Properties
  /**
   * Property subject
   *
   * @description
   * Subject, 60 characters at most.
   *
   * @type {string}
   * @readonly
   */
  readonly subject: string;

  /**
   * Property html
   *
   * @description
   * HTML part, with its preheader.
   *
   * @type {string}
   * @readonly
   */
  readonly html: string;

  /**
   * Property text
   *
   * @description
   * Plain-text part, with the same content.
   *
   * @type {string}
   * @readonly
   */
  readonly text: string;
  // #endregion
}

/**
 * Interface EmailRenderer
 *
 * @description
 * Renders the e-mails from the templates compiled at build time. Rendering is pure and
 * synchronous: a missing value fails it instead of leaving a placeholder in the e-mail.
 */
export interface EmailRenderer {
  // #region Methods
  /**
   * Method renderCodeEmail
   *
   * @description
   * Renders a code e-mail in French, the only language of the mockup.
   *
   * @param {CodeEmailMessage} message - What the e-mail says.
   * @returns {RenderedEmail} The subject and the two parts.
   */
  renderCodeEmail(message: CodeEmailMessage): RenderedEmail;
  // #endregion
}

/**
 * Constant EMAIL_RENDERER
 *
 * @description
 * Injection token of the `EmailRenderer`.
 *
 * @type {unique symbol}
 */
export const EMAIL_RENDERER: unique symbol = Symbol('EmailRenderer');
