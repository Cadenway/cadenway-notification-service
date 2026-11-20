import type { RenderedEmail } from '../../../../models/code-email/rendered-email.model.js';

/** Renders activity notices without links or content specific to their subjects. */
export interface ActivityNoticeRenderer {
  // #region Methods
  /** Renders the generic notice from the account language and authorized total. */
  renderActivityNotice(language: string, count: number): RenderedEmail;
  // #endregion
}
