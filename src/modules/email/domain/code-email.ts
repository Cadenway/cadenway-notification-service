import { InvalidCodeValidityError } from './errors.js';

/**
 * Type CodeEmailPurpose
 *
 * @description
 * What a code proves, the `purpose` of `one-time-code.issued.v1`: `email-verification` confirms
 * the address of a sign-up, `sign-in` signs in without a password, `email-change` confirms a new
 * address (emitted once address changes exist).
 *
 * @type {'email-verification' | 'sign-in' | 'email-change'}
 */
export type CodeEmailPurpose = 'email-verification' | 'sign-in' | 'email-change';

/**
 * Type CodeEmailTemplate
 *
 * @description
 * The templates of the code e-mails this service sends, named after their purpose: the
 * "Confirmation de l’adresse" and "Code de connexion" e-mails of the Emails artboard of the
 * mockup.
 *
 * @type {'email-verification' | 'sign-in'}
 */
export type CodeEmailTemplate = 'email-verification' | 'sign-in';

/**
 * Type CodeEmailSkipReason
 *
 * @description
 * Why a code e-mail is not sent: `expired`, its code stopped working before the e-mail could
 * leave (the contract forbids sending it); `purpose-not-supported`, no template exists for its
 * purpose yet (`email-change`, a later phase).
 *
 * @type {'expired' | 'purpose-not-supported'}
 */
export type CodeEmailSkipReason = 'expired' | 'purpose-not-supported';

/**
 * Type CodeEmailDecision
 *
 * @description
 * What to do with an issued code: send the e-mail of a template, or skip it for a reason.
 *
 * @type {{ readonly kind: 'send'; readonly template: CodeEmailTemplate } | { readonly kind: 'skip'; readonly reason: CodeEmailSkipReason }}
 */
export type CodeEmailDecision =
  | { readonly kind: 'send'; readonly template: CodeEmailTemplate }
  | { readonly kind: 'skip'; readonly reason: CodeEmailSkipReason };

/**
 * Constant MINUTE_MS
 *
 * @description
 * One minute, in milliseconds.
 *
 * @type {number}
 */
const MINUTE_MS: number = 60_000;

/**
 * Class CodeValidity
 *
 * @description
 * When a code was issued and when it stops working (`occurredAt` and `expiresAt` of
 * `one-time-code.issued.v1`). The contract gives a sign-up or sign-in code 10 minutes; the e-mail
 * says how long the code is valid, from these two instants, and a code whose expiry has passed is
 * never sent.
 */
export class CodeValidity {
  // #region Properties
  /**
   * Property issuedAt
   *
   * @description
   * When the code was issued.
   *
   * @type {Date}
   * @readonly
   */
  public readonly issuedAt: Date;

  /**
   * Property expiresAt
   *
   * @description
   * When the code stops working, strictly after `issuedAt`.
   *
   * @type {Date}
   * @readonly
   */
  public readonly expiresAt: Date;

  /**
   * Property minutes
   *
   * @description
   * How long the code is valid from its issue, in whole minutes and at least 1: the "10" of
   * "Valable 10 minutes, une seule fois". Rounded, so a few milliseconds between the two instants
   * of the event do not turn 10 minutes into 9.
   *
   * @type {number}
   */
  public get minutes(): number {
    return Math.max(
      1,
      Math.round((this.expiresAt.getTime() - this.issuedAt.getTime()) / MINUTE_MS),
    );
  }
  // #endregion

  // #region Constructor
  /**
   * Constructor
   *
   * @description
   * Keeps two instants already checked by `between`.
   *
   * @param {Date} issuedAt - When the code was issued.
   * @param {Date} expiresAt - When the code stops working.
   * @constructor
   */
  private constructor(issuedAt: Date, expiresAt: Date) {
    this.issuedAt = issuedAt;
    this.expiresAt = expiresAt;
  }
  // #endregion

  // #region Methods
  /**
   * Method between
   *
   * @description
   * Builds the validity of a code. The instants are copied, so the caller cannot change them
   * afterwards.
   *
   * @param {Date} issuedAt - When the code was issued.
   * @param {Date} expiresAt - When the code stops working.
   * @returns {CodeValidity} The validity.
   * @throws {InvalidCodeValidityError} When an instant is invalid or the code expires before it
   * was issued.
   */
  public static between(issuedAt: Date, expiresAt: Date): CodeValidity {
    const issued: number = issuedAt.getTime();
    const expires: number = expiresAt.getTime();
    if (Number.isNaN(issued) || Number.isNaN(expires) || expires <= issued) {
      throw new InvalidCodeValidityError();
    }
    return new CodeValidity(new Date(issued), new Date(expires));
  }

  /**
   * Method isExpiredAt
   *
   * @description
   * Whether the code no longer works at an instant: from `expiresAt` on, as identity-service
   * refuses it (`auth.code-expired` of the public auth contract).
   *
   * @param {Date} now - The instant to check.
   * @returns {boolean} `true` from the expiry on.
   */
  public isExpiredAt(now: Date): boolean {
    return now.getTime() >= this.expiresAt.getTime();
  }
  // #endregion
}

/**
 * Function codeEmailTemplateFor
 *
 * @description
 * The template of a purpose: `email-verification` and `sign-in` have theirs; `email-change` has
 * none yet, its e-mail comes with address changes.
 *
 * @param {CodeEmailPurpose} purpose - Purpose of the code.
 * @returns {CodeEmailTemplate | null} The template, or `null` when the purpose is not sent yet.
 */
export function codeEmailTemplateFor(purpose: CodeEmailPurpose): CodeEmailTemplate | null {
  switch (purpose) {
    case 'email-verification':
      return 'email-verification';
    case 'sign-in':
      return 'sign-in';
    case 'email-change':
      return null;
  }
}

/**
 * Function decideCodeEmail
 *
 * @description
 * Decides whether the e-mail of an issued code leaves. A security e-mail is always sent: no
 * preference, Do not disturb or digest applies (cw-notification-domain). It is skipped only when
 * no template exists for its purpose, or when its code already expired: the contract of
 * `one-time-code.issued.v1` says a consumer does not send a code whose `expiresAt` has passed.
 *
 * @param {CodeEmailPurpose} purpose - Purpose of the code.
 * @param {CodeValidity} validity - When the code was issued and stops working.
 * @param {Date} now - The current instant.
 * @returns {CodeEmailDecision} Send with a template, or skip with a reason.
 */
export function decideCodeEmail(
  purpose: CodeEmailPurpose,
  validity: CodeValidity,
  now: Date,
): CodeEmailDecision {
  const template: CodeEmailTemplate | null = codeEmailTemplateFor(purpose);
  if (template === null) {
    return { kind: 'skip', reason: 'purpose-not-supported' };
  }
  if (validity.isExpiredAt(now)) {
    return { kind: 'skip', reason: 'expired' };
  }
  return { kind: 'send', template };
}
