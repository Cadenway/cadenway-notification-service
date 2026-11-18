/**
 * Constant KEY_NAME_PATTERN
 *
 * @description
 * What the name of a security key may look like to be shown: a letter or a digit, then up to 59
 * letters, digits, spaces, apostrophes, dots, commas, hyphens, underscores, parentheses, plus,
 * ampersand or number signs ("YubiKey 5C NFC", "Touch ID (MacBook Air)", "Clé de Camille").
 *
 * @type {RegExp}
 */
const KEY_NAME_PATTERN: RegExp = /^[\p{L}\p{N}][\p{L}\p{N} ’'.,_()+&#-]{0,59}$/u;

/**
 * Constant DOMAIN_LIKE
 *
 * @description
 * A letter or a digit, a dot and a letter: what a domain name looks like ("aide.example",
 * "cadenway2.fr"), which a mail client may turn into a link; a top-level domain starts with a
 * letter, so a version ("v1.2") is not one.
 *
 * @type {RegExp}
 */
const DOMAIN_LIKE: RegExp = /[\p{L}\p{N}]\.\p{L}/u;

/**
 * Constant MAX_KEY_NAME_DIGITS
 *
 * @description
 * Digits a name may hold, as many as a device name (`client-text.policy`): enough for a model
 * ("YubiKey 5C NFC", "iPhone 15 Pro"), too few for a phone number, a short one ("118 218")
 * included.
 *
 * @type {number}
 */
const MAX_KEY_NAME_DIGITS: number = 4;

/**
 * Function shownSecurityKeyName
 *
 * @description
 * The name of a security key as the e-mail of `security-key-added` or `security-key-removed` may
 * show it, or `null` to name no key. The name was typed in a session of the account (`securityKey`
 * of `user.two-step-verification-changed.v1`), so whoever holds a session chooses the text a
 * genuine e-mail of Cadenway carries to the address of the account: a name that does not look like
 * the name of a device (a domain, an address, a phone number, a sentence with other signs) is not
 * repeated, as the names of the device are not (`client-text.policy`).
 *
 * @param {string | null} name - The name, already cleaned of controls and format characters
 * (`greetingName`), or `null` when the event names no key.
 * @returns {string | null} The name, or `null`.
 */
export function shownSecurityKeyName(name: string | null): string | null {
  if (name === null || !KEY_NAME_PATTERN.test(name) || DOMAIN_LIKE.test(name)) {
    return null;
  }
  return name.replace(/[^0-9]/gu, '').length > MAX_KEY_NAME_DIGITS ? null : name;
}
