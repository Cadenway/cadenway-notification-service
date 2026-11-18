/**
 * Constant DEVICE_TYPES
 *
 * @description
 * The device types of `client.device.type` in the identity-service events. The contract lets later
 * versions add types without a new event version; a consumer treats an unknown one as `unknown`.
 *
 * @type {ReadonlySet<string>}
 */
const DEVICE_TYPES: ReadonlySet<string> = new Set<string>(['desktop', 'mobile', 'tablet']);

/**
 * Constant NAME_PATTERN
 *
 * @description
 * What the name of a browser or an operating system may look like to be shown: a letter, then up
 * to 39 letters, digits, spaces, dots, hyphens, underscores, parentheses or plus signs ("Firefox",
 * "Microsoft Edge", "Chrome OS", "Windows").
 *
 * @type {RegExp}
 */
const NAME_PATTERN: RegExp = /^\p{L}[\p{L}\p{N} ._()+-]{0,39}$/u;

/**
 * Constant DOMAIN_LIKE
 *
 * @description
 * A letter or a digit, a dot and a letter: what a domain name looks like ("aide.example",
 * "cadenway1.fr"), which a mail client may turn into a link; a top-level domain starts with a
 * letter.
 *
 * @type {RegExp}
 */
const DOMAIN_LIKE: RegExp = /[\p{L}\p{N}]\.\p{L}/u;

/**
 * Constant MAX_NAME_DIGITS
 *
 * @description
 * Digits a name may hold: enough for "Windows 11" or "Opera 100", too few for a phone number.
 *
 * @type {number}
 */
const MAX_NAME_DIGITS: number = 4;

/**
 * Constant VERSION_PATTERN
 *
 * @description
 * What the version of an operating system may look like to be shown: up to four groups of up to
 * four digits, separated by dots ("11", "18.1", "10.15.7").
 *
 * @type {RegExp}
 */
const VERSION_PATTERN: RegExp = /^[0-9]{1,4}(?:\.[0-9]{1,4}){0,3}$/u;

/**
 * Constant IPV4_PATTERN
 *
 * @description
 * An IPv4 address in dotted decimal form.
 *
 * @type {RegExp}
 */
const IPV4_PATTERN: RegExp =
  /^(?:(?:25[0-5]|2[0-4][0-9]|1[0-9]{2}|[1-9]?[0-9])\.){3}(?:25[0-5]|2[0-4][0-9]|1[0-9]{2}|[1-9]?[0-9])$/u;

/**
 * Constant IPV6_PATTERN
 *
 * @description
 * The characters of an IPv6 address, an IPv4-mapped one included: hexadecimal digits, colons and
 * dots, 45 at most (`ipAddress` of the contract).
 *
 * @type {RegExp}
 */
const IPV6_PATTERN: RegExp = /^[0-9A-Fa-f:.]{2,45}$/u;

/**
 * Function knownDeviceType
 *
 * @description
 * The device type an e-mail reads: `desktop`, `mobile` or `tablet`, and `unknown` for any other
 * value, as the contract of the `Device` schema of identity-service asks of a consumer.
 *
 * @param {string} type - `client.device.type` of the event.
 * @returns {string} One of `desktop`, `mobile`, `tablet` and `unknown`.
 */
export function knownDeviceType(type: string): string {
  return DEVICE_TYPES.has(type) ? type : 'unknown';
}

/**
 * Function shownDeviceName
 *
 * @description
 * The name of a browser or an operating system as a security e-mail may show it, or `null` to show
 * none. identity-service reads these names from the `User-Agent`, which the browser writes, and the
 * reset e-mail can be asked for any address without signing in (`password-reset-link.issued.v1`):
 * a name that does not look like a product name (a domain, a phone number, a sentence) is not
 * repeated in a genuine e-mail of Cadenway (security review of the account security e-mails).
 *
 * @param {string | null} name - The name, already cleaned of controls and format characters.
 * @returns {string | null} The name, or `null`.
 */
export function shownDeviceName(name: string | null): string | null {
  if (name === null || !NAME_PATTERN.test(name) || DOMAIN_LIKE.test(name)) {
    return null;
  }
  return name.replace(/[^0-9]/gu, '').length > MAX_NAME_DIGITS ? null : name;
}

/**
 * Function shownVersion
 *
 * @description
 * The version of an operating system as a security e-mail may show it, numbers only ("18.1"), or
 * `null` to show none, for the reason `shownDeviceName` gives.
 *
 * @param {string | null} version - The version, already cleaned of controls and format characters.
 * @returns {string | null} The version, or `null`.
 */
export function shownVersion(version: string | null): string | null {
  return version !== null && VERSION_PATTERN.test(version) ? version : null;
}

/**
 * Function shownIpAddress
 *
 * @description
 * The IP address as a security e-mail may show it: an IPv4 address in dotted form or an IPv6 one
 * (hexadecimal digits, colons and dots, with two colons at least), or `null` to show none. The
 * gateway reads it from the request, behind one trusted proxy.
 *
 * @param {string} address - `client.ipAddress` of the event, already cleaned.
 * @returns {string | null} The address, or `null`.
 */
export function shownIpAddress(address: string): string | null {
  if (IPV4_PATTERN.test(address)) {
    return address;
  }
  return IPV6_PATTERN.test(address) && address.split(':').length >= 3 ? address : null;
}
