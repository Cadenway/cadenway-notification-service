import type { InvitationEmailMessage } from '../../../application/models/invitation-email/invitation-email-message.model.js';
import type { InvitationRole } from '../../../domain/value-objects/invitation-email/invitation-role.value-object.js';

/**
 * Interface InvitationEmailContext
 *
 * @description
 * The values of the "invitation" template, worded in French as the "Invitation" e-mail of the
 * Emails artboard of the mockup says them. Plain text: the HTML part escapes them, the subject and
 * the text part do not.
 */
export interface InvitationEmailContext {
  // #region Properties
  /**
   * Property inviterName
   *
   * @description
   * Full name of the inviter: "Hugo Durand".
   *
   * @type {string}
   * @readonly
   */
  readonly inviterName: string;

  /**
   * Property inviterFirstName
   *
   * @description
   * First word of the name of the inviter, for "Vous ne connaissez pas Hugo ?".
   *
   * @type {string}
   * @readonly
   */
  readonly inviterFirstName: string;

  /**
   * Property inviterInitials
   *
   * @description
   * Initials of the inviter in the header: "HD".
   *
   * @type {string}
   * @readonly
   */
  readonly inviterInitials: string;

  /**
   * Property organizationName
   *
   * @description
   * Name of the organization: "Atelier Nord".
   *
   * @type {string}
   * @readonly
   */
  readonly organizationName: string;

  /**
   * Property organizationInitials
   *
   * @description
   * Initials of the organization in the header: "AN".
   *
   * @type {string}
   * @readonly
   */
  readonly organizationInitials: string;

  /**
   * Property ofOrganization
   *
   * @description
   * The organization after "un membre": "d’Atelier Nord", "de Studio Nord".
   *
   * @type {string}
   * @readonly
   */
  readonly ofOrganization: string;

  /**
   * Property memberCountLabel
   *
   * @description
   * The member count of the header: "18 membres", "1 membre".
   *
   * @type {string}
   * @readonly
   */
  readonly memberCountLabel: string;

  /**
   * Property roleLabel
   *
   * @description
   * The proposed role: "Administrateur", "Membre" or "Invité".
   *
   * @type {string}
   * @readonly
   */
  readonly roleLabel: string;

  /**
   * Property expiryDate
   *
   * @description
   * The day the invitation expires, in Paris: "16 novembre 2026".
   *
   * @type {string}
   * @readonly
   */
  readonly expiryDate: string;

  /**
   * Property invitationUrl
   *
   * @description
   * Target of the "Rejoindre" button: `<web application>/invite/<invitationId>`.
   *
   * @type {string}
   * @readonly
   */
  readonly invitationUrl: string;
  // #endregion
}

/**
 * Constant ROLE_LABELS
 *
 * @description
 * The French names of the roles an invitation proposes, from the role select of the mockup
 * (Organisation › Membres) and the "Rôle proposé : Membre." of the "Invitation" e-mail.
 *
 * @type {Readonly<Record<InvitationRole, string>>}
 */
const ROLE_LABELS: Readonly<Record<InvitationRole, string>> = {
  admin: 'Administrateur',
  member: 'Membre',
  guest: 'Invité',
};

/**
 * Constant TIME_ZONE
 *
 * @description
 * Time zone of the dates of the e-mail. The invitee may have no account, so no time zone of their
 * own: the e-mail uses Paris, the time zone of the mockup ("heure de Paris") and of every example
 * account.
 *
 * @type {string}
 */
const TIME_ZONE: string = 'Europe/Paris';

/**
 * Constant DATE_PARTS
 *
 * @description
 * Formats the day, month and year of an instant in Paris, in French: "16 novembre 2026".
 *
 * @type {Intl.DateTimeFormat}
 */
const DATE_PARTS: Intl.DateTimeFormat = new Intl.DateTimeFormat('fr-FR', {
  day: 'numeric',
  month: 'long',
  year: 'numeric',
  timeZone: TIME_ZONE,
});

/**
 * Constant COUNT
 *
 * @description
 * Formats a whole number in French, with the narrow no-break space between thousands.
 *
 * @type {Intl.NumberFormat}
 */
const COUNT: Intl.NumberFormat = new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 0 });

/**
 * Constant ELIDING
 *
 * @description
 * First letters before which "de" is elided to "d’": the vowels and "y", with or without accent.
 * A name starting with "h" keeps "de", since the e-mail cannot tell a mute "h" from an aspirated
 * one.
 *
 * @type {RegExp}
 */
const ELIDING: RegExp = /^[aàâäeéèêëiîïoôöuùûüyÿæœ]/iu;

/**
 * Function wordsOf
 *
 * @description
 * The words of a name, split on spaces.
 *
 * @param {string} name - The name.
 * @returns {readonly string[]} Its words, without empty ones.
 */
function wordsOf(name: string): readonly string[] {
  return name.split(/\s+/u).filter((word) => word !== '');
}

/**
 * Function frenchDate
 *
 * @description
 * The day of an instant in Paris, in French, with "1er" for the first of the month as French
 * writes it: "16 novembre 2026", "1er décembre 2026".
 *
 * @param {Date} instant - The instant.
 * @returns {string} The day, month and year.
 */
export function frenchDate(instant: Date): string {
  const parts: readonly Intl.DateTimeFormatPart[] = DATE_PARTS.formatToParts(instant);
  return parts
    .map((part) => (part.type === 'day' && part.value === '1' ? '1er' : part.value))
    .join('');
}

/**
 * Function initialsOf
 *
 * @description
 * The initials of a name as the mockup computes them for an organization without a logo: the
 * first letter of its first two words, in capitals ("Atelier Nord" gives "AN", "Lumen" gives "L").
 *
 * @param {string} name - The name.
 * @returns {string} Its initials, empty for an empty name.
 */
export function initialsOf(name: string): string {
  return wordsOf(name)
    .slice(0, 2)
    .map((word) => (Array.from(word)[0] ?? '').toLocaleUpperCase('fr-FR'))
    .join('');
}

/**
 * Function firstNameOf
 *
 * @description
 * The first word of a full name, as the mockup says "Vous ne connaissez pas Hugo ?" for Hugo
 * Durand.
 *
 * @param {string} name - The full name.
 * @returns {string} Its first word, or the name itself when it has none.
 */
export function firstNameOf(name: string): string {
  return wordsOf(name)[0] ?? name;
}

/**
 * Function ofOrganization
 *
 * @description
 * The organization introduced by "de", elided before a vowel as French requires: "d’Atelier Nord"
 * (the footer of the mockup), "de Studio Nord".
 *
 * @param {string} name - Name of the organization.
 * @returns {string} "d’" or "de " followed by the name.
 */
export function ofOrganization(name: string): string {
  return ELIDING.test(name) ? `d’${name}` : `de ${name}`;
}

/**
 * Function memberCountLabel
 *
 * @description
 * The member count of the header of the e-mail: "18 membres", "1 membre". The space count of the
 * mockup ("· 6 espaces") is left out: the event does not carry it.
 *
 * @param {number} count - Members that take a seat.
 * @returns {string} The count and its noun.
 */
export function memberCountLabel(count: number): string {
  return `${COUNT.format(count)} ${count === 1 ? 'membre' : 'membres'}`;
}

/**
 * Function roleLabel
 *
 * @description
 * The French name of a proposed role.
 *
 * @param {InvitationRole} role - The role.
 * @returns {string} Its label.
 */
export function roleLabel(role: InvitationRole): string {
  return ROLE_LABELS[role];
}

/**
 * Function invitationEmailContext
 *
 * @description
 * Words an invitation message for the "invitation" template.
 *
 * @param {InvitationEmailMessage} message - What the e-mail says.
 * @param {string} webAppUrl - Origin of the web application, without a trailing slash.
 * @returns {InvitationEmailContext} The values of the template.
 */
export function invitationEmailContext(
  message: InvitationEmailMessage,
  webAppUrl: string,
): InvitationEmailContext {
  return {
    inviterName: message.inviterName,
    inviterFirstName: firstNameOf(message.inviterName),
    inviterInitials: initialsOf(message.inviterName),
    organizationName: message.organizationName,
    organizationInitials: initialsOf(message.organizationName),
    ofOrganization: ofOrganization(message.organizationName),
    memberCountLabel: memberCountLabel(message.memberCount),
    roleLabel: roleLabel(message.role),
    expiryDate: frenchDate(message.expiresAt),
    invitationUrl: `${webAppUrl}/invite/${encodeURIComponent(message.invitationId)}`,
  };
}
