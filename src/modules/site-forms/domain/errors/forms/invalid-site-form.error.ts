/** Base error for the rules enforced by the site forms domain. */
abstract class DomainError extends Error {}

type SiteFormField = 'email' | 'subject' | 'message';

const fieldErrors = {
  email: 'Invalid public site mailbox.',
  subject: 'Invalid contact topic.',
  message: 'Invalid contact message length.',
} as const;

/** Identifies the refused form field without exposing anything submitted by the visitor. */
export class InvalidSiteFormError extends DomainError {
  // #region Properties
  /** Name of the invalid field. */
  public readonly field: SiteFormField;
  // #endregion

  // #region Constructor
  /** Creates a field-only refusal using a fixed message. */
  public constructor(field: SiteFormField) {
    super(fieldErrors[field]);
    this.name = 'InvalidSiteFormError';
    this.field = field;
  }
  // #endregion
}
