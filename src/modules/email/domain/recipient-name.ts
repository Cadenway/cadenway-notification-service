/**
 * Constant INVISIBLE_OR_BREAKING
 *
 * @description
 * Characters a name may not bring into an e-mail: controls (line breaks, tabulations), format
 * characters (bidirectional overrides, zero-width joiners) and the line and paragraph separators.
 *
 * @type {RegExp}
 */
const INVISIBLE_OR_BREAKING: RegExp = /[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]/gu;

/**
 * Function greetingName
 *
 * @description
 * The name an e-mail greets its recipient with. `recipient.name` of `one-time-code.issued.v1` is
 * what was typed at the sign-up, by anyone who knows the address, before the address is verified
 * (security review of the auth walking skeleton): the name keeps its letters, punctuation and
 * spaces, but loses the characters that would break the layout of the e-mail or reorder its text,
 * and its spaces are collapsed. It may come out empty; the templates then greet without a name.
 *
 * @param {string} name - Full name of the account, as the event gives it.
 * @returns {string} The name to show, possibly empty.
 */
export function greetingName(name: string): string {
  return name.replace(INVISIBLE_OR_BREAKING, ' ').replace(/\s+/gu, ' ').trim();
}
