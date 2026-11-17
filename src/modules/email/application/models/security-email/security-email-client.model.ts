/**
 * Interface SecurityEmailClient
 *
 * @description
 * The browser a security e-mail reports, from `client` of the identity-service events: what the
 * rows "Appareil" and "Adresse IP" show. The browser version is left out, as the e-mails of the
 * mockup show none ("Firefox sur Windows 11"); no place is derived from the address. Each text is
 * kept only when it looks like what it claims to be (`client-text.policy`), since a browser writes
 * its own `User-Agent`. Personal data, never logged.
 */
export interface SecurityEmailClient {
  // #region Properties
  /**
   * Property deviceType
   *
   * @description
   * `desktop`, `mobile`, `tablet` or `unknown`; a value the contract adds later reads as `unknown`.
   *
   * @type {string}
   * @readonly
   */
  readonly deviceType: string;

  /**
   * Property browser
   *
   * @description
   * Name of the browser or client; `null` when identity-service could not read it, or when it does
   * not look like a product name.
   *
   * @type {string | null}
   * @readonly
   */
  readonly browser: string | null;

  /**
   * Property os
   *
   * @description
   * Name of the operating system; `null` when identity-service could not read it, or when it does
   * not look like a product name.
   *
   * @type {string | null}
   * @readonly
   */
  readonly os: string | null;

  /**
   * Property osVersion
   *
   * @description
   * Version of the operating system, numbers only; `null` when the `User-Agent` does not tell it.
   *
   * @type {string | null}
   * @readonly
   */
  readonly osVersion: string | null;

  /**
   * Property ipAddress
   *
   * @description
   * IPv4 or IPv6 address of the browser, as the gateway saw it; `null` when the event holds
   * something else.
   *
   * @type {string | null}
   * @readonly
   */
  readonly ipAddress: string | null;
  // #endregion
}
