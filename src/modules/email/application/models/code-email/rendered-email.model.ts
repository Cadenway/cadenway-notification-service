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
