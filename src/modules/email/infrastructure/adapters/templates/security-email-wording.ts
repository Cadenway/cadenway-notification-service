import type { SecurityEmailClient } from '../../../application/models/security-email/security-email-client.model.js';
import type { SecurityEmailMessage } from '../../../application/models/security-email/security-email-message.model.js';
import type { PasswordChangeMethod } from '../../../domain/value-objects/security-email/password-change-method.value-object.js';

/**
 * Type SecurityEmailContext
 *
 * @description
 * The values of a security template, worded in French as the "Compte et sécurité" e-mails of the
 * Emails artboard say them. Plain text: the HTML part escapes them, the subject and the text part
 * do not.
 *
 * @type {Readonly<Record<string, string | number>>}
 */
export type SecurityEmailContext = Readonly<Record<string, string | number>>;

/**
 * Constant PARIS
 *
 * @description
 * Time zone of the mockup ("heure de Paris") and of every example account, used when the time
 * zone of the event is unknown to the runtime.
 *
 * @type {string}
 */
const PARIS: string = 'Europe/Paris';

/**
 * Constant DAY_MS
 *
 * @description
 * One day, in milliseconds.
 *
 * @type {number}
 */
const DAY_MS: number = 86_400_000;

/**
 * Constant DEVICE_TYPES
 *
 * @description
 * The device types of the contract, as a row names a device alone ("Mobile") and as it follows a
 * browser ("Firefox sur un mobile"). Any other type, `unknown` included, has no label. A map, so
 * that no key of `Object.prototype` reads as a type.
 *
 * @type {ReadonlyMap<string, { readonly alone: string; readonly after: string }>}
 */
const DEVICE_TYPES: ReadonlyMap<string, { readonly alone: string; readonly after: string }> =
  new Map<string, { readonly alone: string; readonly after: string }>([
    ['desktop', { alone: 'Ordinateur', after: 'un ordinateur' }],
    ['mobile', { alone: 'Mobile', after: 'un mobile' }],
    ['tablet', { alone: 'Tablette', after: 'une tablette' }],
  ]);

/**
 * Constant UNKNOWN_IP_ADDRESS
 *
 * @description
 * What the row "Adresse IP" says when the event holds no showable address.
 *
 * @type {string}
 */
const UNKNOWN_IP_ADDRESS: string = 'Adresse inconnue';

/**
 * Constant BACKUP_CODE_COUNT
 *
 * @description
 * Backup codes a setup or a regeneration gives, the most an account holds (`backupCodesRemaining`
 * of `user.two-step-verification-changed.v1`, "7 codes inutilisés sur 10" of Compte › Sécurité et
 * connexion).
 *
 * @type {number}
 */
const BACKUP_CODE_COUNT: number = 10;

/**
 * Interface ZonedParts
 *
 * @description
 * The parts of an instant in a time zone, in French.
 */
interface ZonedParts {
  // #region Properties
  /**
   * Property day
   *
   * @description
   * Day of the month, "1er" for the first: "9", "1er".
   *
   * @type {string}
   * @readonly
   */
  readonly day: string;

  /**
   * Property month
   *
   * @description
   * Name of the month: "novembre".
   *
   * @type {string}
   * @readonly
   */
  readonly month: string;

  /**
   * Property year
   *
   * @description
   * Year: "2026".
   *
   * @type {string}
   * @readonly
   */
  readonly year: string;

  /**
   * Property time
   *
   * @description
   * Hours and minutes on 24 hours: "08:42".
   *
   * @type {string}
   * @readonly
   */
  readonly time: string;

  /**
   * Property zone
   *
   * @description
   * The time zone as the e-mail names it: "heure de Paris" for Paris, as the mockup, else the
   * offset at that instant ("UTC−5", "UTC").
   *
   * @type {string}
   * @readonly
   */
  readonly zone: string;
  // #endregion
}

/**
 * Function canonicalZone
 *
 * @description
 * The canonical name of a time zone the runtime knows, or Paris for an unknown one: the contract
 * gives a free IANA name of at most 64 characters, and an e-mail is never held back for it.
 *
 * @param {string} timeZone - Time zone of the event.
 * @returns {string} A time zone the runtime formats.
 */
function canonicalZone(timeZone: string): string {
  try {
    return new Intl.DateTimeFormat('fr-FR', { timeZone }).resolvedOptions().timeZone;
  } catch {
    return PARIS;
  }
}

/**
 * Function zonedParts
 *
 * @description
 * The parts of an instant in a time zone, Paris when the zone is unknown.
 *
 * @param {Date} instant - The instant.
 * @param {string} timeZone - Time zone of the event.
 * @returns {ZonedParts} Its parts.
 */
function zonedParts(instant: Date, timeZone: string): ZonedParts {
  const zone: string = canonicalZone(timeZone);
  const parts: readonly Intl.DateTimeFormatPart[] = new Intl.DateTimeFormat('fr-FR', {
    timeZone: zone,
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
    timeZoneName: 'shortOffset',
  }).formatToParts(instant);
  const part = (type: Intl.DateTimeFormatPartTypes): string =>
    parts.find((candidate) => candidate.type === type)?.value ?? '';
  const offset: string = part('timeZoneName');
  return {
    day: part('day') === '1' ? '1er' : part('day'),
    month: part('month'),
    year: part('year'),
    time: `${part('hour')}:${part('minute')}`,
    zone: zone === PARIS ? 'heure de Paris' : offset === 'UTC+0' ? 'UTC' : offset,
  };
}

/**
 * Function dateTimeLabel
 *
 * @description
 * The row "Date" of a security e-mail: "9 novembre 2026 à 14:07 (heure de Paris)", in the time
 * zone of the account, with the zone named as the mockup does for Paris and by its offset
 * elsewhere ("9 novembre 2026 à 08:07 (UTC−5)").
 *
 * @param {Date} instant - The instant.
 * @param {string} timeZone - Time zone of the account; Paris when unknown.
 * @returns {string} The date, time and zone.
 */
export function dateTimeLabel(instant: Date, timeZone: string): string {
  const parts: ZonedParts = zonedParts(instant, timeZone);
  return `${parts.day} ${parts.month} ${parts.year} à ${parts.time} (${parts.zone})`;
}

/**
 * Function shortDateTimeLabel
 *
 * @description
 * The date of the preheader of "Nouvelle connexion": "9 novembre à 08:42", without the year.
 *
 * @param {Date} instant - The instant.
 * @param {string} timeZone - Time zone of the account; Paris when unknown.
 * @returns {string} The day, month and time.
 */
export function shortDateTimeLabel(instant: Date, timeZone: string): string {
  const parts: ZonedParts = zonedParts(instant, timeZone);
  return `${parts.day} ${parts.month} à ${parts.time}`;
}

/**
 * Function dayLabel
 *
 * @description
 * A day in the time zone of the account: "9 décembre 2026", "1er janvier 2027".
 *
 * @param {Date} instant - The instant.
 * @param {string} timeZone - Time zone of the account; Paris when unknown.
 * @returns {string} The day, month and year.
 */
export function dayLabel(instant: Date, timeZone: string): string {
  const parts: ZonedParts = zonedParts(instant, timeZone);
  return `${parts.day} ${parts.month} ${parts.year}`;
}

/**
 * Function dayMonthLabel
 *
 * @description
 * A day without its year, as the heading of "Suppression du compte" says it: "9 décembre".
 *
 * @param {Date} instant - The instant.
 * @param {string} timeZone - Time zone of the account; Paris when unknown.
 * @returns {string} The day and month.
 */
export function dayMonthLabel(instant: Date, timeZone: string): string {
  const parts: ZonedParts = zonedParts(instant, timeZone);
  return `${parts.day} ${parts.month}`;
}

/**
 * Function delayLabel
 *
 * @description
 * How long until the deletion, in whole days and at least one: "30 jours", "1 jour".
 *
 * @param {Date} from - When the deletion was scheduled.
 * @param {Date} to - When the account will be deleted.
 * @returns {string} The delay and its noun.
 */
export function delayLabel(from: Date, to: Date): string {
  const days: number = Math.max(1, Math.round((to.getTime() - from.getTime()) / DAY_MS));
  return `${String(days)} ${days === 1 ? 'jour' : 'jours'}`;
}

/**
 * Function operatingSystemOf
 *
 * @description
 * The operating system with its version when the event tells it: "Windows", "iOS 18.1".
 *
 * @param {string} os - Name of the operating system.
 * @param {string | null} version - Its version, or `null`.
 * @returns {string} The name and version.
 */
function operatingSystemOf(os: string, version: string | null): string {
  return version === null ? os : `${os} ${version}`;
}

/**
 * Function deviceLabel
 *
 * @description
 * The row "Appareil": the browser on the operating system, as "Firefox sur Windows 11" in the
 * mockup, without the version of the browser the mockup does not show. When identity-service could
 * not read a part of the `User-Agent`, the row says what is known: "Firefox sur un mobile",
 * "Navigateur inconnu sur Windows", "Tablette", or "Appareil inconnu".
 *
 * @param {SecurityEmailClient} client - The browser of the event.
 * @returns {string} The device.
 */
export function deviceLabel(client: SecurityEmailClient): string {
  const type: { readonly alone: string; readonly after: string } | undefined = DEVICE_TYPES.get(
    client.deviceType,
  );
  if (client.browser !== null && client.os !== null) {
    return `${client.browser} sur ${operatingSystemOf(client.os, client.osVersion)}`;
  }
  if (client.browser !== null) {
    return type === undefined ? client.browser : `${client.browser} sur ${type.after}`;
  }
  if (client.os !== null) {
    return `Navigateur inconnu sur ${operatingSystemOf(client.os, client.osVersion)}`;
  }
  return type?.alone ?? 'Appareil inconnu';
}

/**
 * Function subjectDevice
 *
 * @description
 * The device of the subject of "Nouvelle connexion depuis Safari sur iPhone": the browser and the
 * operating system without versions, or empty when either is unknown, in which case the template
 * falls back on "Nouvelle connexion à votre compte Cadenway".
 *
 * @param {SecurityEmailClient} client - The browser of the event.
 * @returns {string} "Safari sur iOS", or empty.
 */
export function subjectDevice(client: SecurityEmailClient): string {
  return client.browser !== null && client.os !== null ? `${client.browser} sur ${client.os}` : '';
}

/**
 * Function closedSessionsLabel
 *
 * @description
 * What the "Mot de passe modifié" e-mail says of the closed sessions, after "Par sécurité, ", from
 * what actually happened instead of the mockup's fixed "vos 3 autres sessions ont été fermées"
 * (decision 3 of the account security brief): a change keeps every session, a reset closes the
 * other sessions unless the person unticked "Fermer mes autres sessions". Empty when none was
 * closed, in which case the template says "Vos autres sessions restent ouvertes.", the wording of
 * the reset screen.
 *
 * @param {PasswordChangeMethod} method - How the password changed.
 * @param {number} closedSessionCount - Sessions the change closed.
 * @returns {string} The closed sessions, or empty.
 */
export function closedSessionsLabel(
  method: PasswordChangeMethod,
  closedSessionCount: number,
): string {
  if (method === 'change' || closedSessionCount < 1) {
    return '';
  }
  return closedSessionCount === 1
    ? 'votre autre session a été fermée'
    : `vos ${String(closedSessionCount)} autres sessions ont été fermées`;
}

/**
 * Function generatedCodesLabel
 *
 * @description
 * The row "Codes de secours" of "Vérification en deux étapes activée": "10 codes générés", as the
 * mockup says it, from the backup codes the event counts; singular below two, as French counts.
 *
 * @param {number} count - Backup codes not used yet (`backupCodesRemaining`).
 * @returns {string} The count and its words.
 */
export function generatedCodesLabel(count: number): string {
  return count < 2 ? `${String(count)} code généré` : `${String(count)} codes générés`;
}

/**
 * Function unusedCodesLabel
 *
 * @description
 * The row "Codes de secours" of the regenerated codes: "10 codes inutilisés sur 10", the wording
 * of the row "Codes de secours" of Compte › Sécurité et connexion ("7 codes inutilisés sur 10").
 *
 * @param {number} count - Backup codes not used yet (`backupCodesRemaining`).
 * @returns {string} The count, its words and the total.
 */
export function unusedCodesLabel(count: number): string {
  const codes: string = count < 2 ? 'code inutilisé' : 'codes inutilisés';
  return `${String(count)} ${codes} sur ${String(BACKUP_CODE_COUNT)}`;
}

/**
 * Function clientValues
 *
 * @description
 * The values of the rows "Appareil", "Adresse IP" and "Date".
 *
 * @param {SecurityEmailClient} client - The browser of the event.
 * @param {Date} occurredAt - When the fact happened.
 * @param {string} timeZone - Time zone of the account.
 * @returns {SecurityEmailContext} The three values.
 */
function clientValues(
  client: SecurityEmailClient,
  occurredAt: Date,
  timeZone: string,
): SecurityEmailContext {
  return {
    deviceLabel: deviceLabel(client),
    ipAddress: client.ipAddress ?? UNKNOWN_IP_ADDRESS,
    dateLabel: dateTimeLabel(occurredAt, timeZone),
  };
}

/**
 * Function securityEmailContext
 *
 * @description
 * Words a security message for its template. The links point to the web application: the reset
 * page with the token in the fragment (`/reset#token=…`, so that no server receives or logs it),
 * the forgotten-password page (`/forgot`), the sessions and the two-step verification
 * (`/account/security`, Compte › Sécurité et connexion) and the profile (`/account`), the paths of
 * the Emails artboard and of the contracts. The two-step e-mails link to `/account/security` only:
 * the backup codes are shown once, when they are generated, so no link promises to show them
 * again. An empty `securityKeyName` makes the key e-mails name no key.
 *
 * @param {SecurityEmailMessage} message - What the e-mail says.
 * @param {string} webAppUrl - Origin of the web application, without a trailing slash.
 * @returns {SecurityEmailContext} The values of the template.
 */
export function securityEmailContext(
  message: SecurityEmailMessage,
  webAppUrl: string,
): SecurityEmailContext {
  const details: SecurityEmailMessage['details'] = message.details;
  const sessionsUrl: string = `${webAppUrl}/account/security`;
  switch (details.template) {
    case 'password-reset':
      return {
        ...clientValues(details.client, message.occurredAt, message.timeZone),
        recipientEmail: message.recipientEmail,
        resetUrl: `${webAppUrl}/reset#token=${encodeURIComponent(details.token.reveal())}`,
        validityMinutes: message.validityMinutes,
      };
    case 'password-changed':
      return {
        ...clientValues(details.client, message.occurredAt, message.timeZone),
        sessionsClosed: closedSessionsLabel(details.method, details.closedSessionCount),
        secureAccountUrl: `${webAppUrl}/forgot`,
      };
    case 'email-changed':
      return {
        ...clientValues(details.client, message.occurredAt, message.timeZone),
        newEmail: details.newEmail,
        sessionsUrl,
      };
    case 'new-device':
      return {
        ...clientValues(details.client, message.occurredAt, message.timeZone),
        subjectDevice: subjectDevice(details.client),
        shortDateLabel: shortDateTimeLabel(message.occurredAt, message.timeZone),
        sessionsUrl,
      };
    case 'deletion-scheduled':
      return {
        deleteDate: dayLabel(details.deleteAt, message.timeZone),
        deleteDayMonth: dayMonthLabel(details.deleteAt, message.timeZone),
        deleteDayMonthUpper: dayMonthLabel(details.deleteAt, message.timeZone).toLocaleUpperCase(
          'fr-FR',
        ),
        delayLabel: delayLabel(message.occurredAt, details.deleteAt),
        cancelUrl: `${webAppUrl}/account`,
      };
    case 'deletion-cancelled':
      return {
        ...clientValues(details.client, message.occurredAt, message.timeZone),
        sessionsUrl,
      };
    case 'two-step-enabled':
      return {
        ...clientValues(details.client, message.occurredAt, message.timeZone),
        backupCodesLabel: generatedCodesLabel(details.backupCodesRemaining),
        securityUrl: sessionsUrl,
      };
    case 'backup-codes-regenerated':
      return {
        ...clientValues(details.client, message.occurredAt, message.timeZone),
        backupCodesLabel: unusedCodesLabel(details.backupCodesRemaining),
        securityUrl: sessionsUrl,
      };
    case 'two-step-disabled':
    case 'authenticator-app-replaced':
      return {
        ...clientValues(details.client, message.occurredAt, message.timeZone),
        securityUrl: sessionsUrl,
      };
    case 'security-key-added':
    case 'security-key-removed':
      return {
        ...clientValues(details.client, message.occurredAt, message.timeZone),
        securityKeyName: details.securityKeyName ?? '',
        securityUrl: sessionsUrl,
      };
  }
}
