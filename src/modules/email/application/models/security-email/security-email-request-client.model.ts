/**
 * Interface SecurityEmailRequestClient
 *
 * @description
 * The browser a security e-mail reports, as the identity-service events give it (`client`, schema
 * `Client` of asyncapi/identity-service.yaml): the device identity-service read from the
 * `User-Agent` and the IP address the gateway saw. Raw values, cleaned by `RequestSecurityEmail`
 * before anything is stored; the version of the browser is not kept.
 */
export interface SecurityEmailRequestClient {
  // #region Properties
  /**
   * Property device
   *
   * @description
   * The device: its type (`desktop`, `mobile`, `tablet`, `unknown`, or a later value), the name of
   * the browser, the name and version of the operating system, each `null` when unreadable.
   *
   * @type {{ readonly type: string; readonly browser: string | null; readonly os: string | null; readonly osVersion: string | null }}
   * @readonly
   */
  readonly device: {
    readonly type: string;
    readonly browser: string | null;
    readonly os: string | null;
    readonly osVersion: string | null;
  };

  /**
   * Property ipAddress
   *
   * @description
   * IPv4 or IPv6 address of the browser, as the gateway saw it.
   *
   * @type {string}
   * @readonly
   */
  readonly ipAddress: string;
  // #endregion
}
