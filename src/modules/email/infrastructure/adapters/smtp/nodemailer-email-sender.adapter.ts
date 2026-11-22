import type { OnApplicationShutdown } from '@nestjs/common';
import { createTransport } from 'nodemailer';
import type { SMTPSentMessageInfo, Transporter } from 'nodemailer';
import type { EmailSender } from '../../../application/ports/outbound/smtp/code-email/email-sender.port.js';
import type { OutgoingEmail } from '../../../application/models/code-email/outgoing-email.model.js';
import type { SiteContactEmailSender } from '../../../application/ports/outbound/smtp/site-contact/site-contact-email-sender.port.js';
import type { SendSiteContactEmailInput } from '../../../application/use-cases/commands/site-contact/send-site-contact-email/send-site-contact-email.input.js';

const siteContactSubjects = {
  login: 'Support · Connexion',
  mfa: 'Support · Double authentification',
  org: 'Support · Organisation',
  data: 'Support · Données personnelles',
  other: 'Support · Autre demande',
} as const satisfies Record<SendSiteContactEmailInput['subject'], string>;

/**
 * Interface SmtpSettings
 *
 * @description
 * The SMTP server and the sender, from `EmailConfig` of `src/config/app-config.ts`.
 */
export interface SmtpSettings {
  // #region Properties
  /**
   * Property host
   *
   * @description
   * Host name of the SMTP server.
   *
   * @type {string}
   * @readonly
   */
  readonly host: string;

  /**
   * Property port
   *
   * @description
   * Port of the SMTP server; 465 opens the connection in TLS.
   *
   * @type {number}
   * @readonly
   */
  readonly port: number;

  /** Development-only exception validated by the service configuration. */
  readonly allowInsecureLocal: boolean;

  /**
   * Property user
   *
   * @description
   * Account on the server, or `undefined` for a server that asks for none.
   *
   * @type {string | undefined}
   * @readonly
   */
  readonly user: string | undefined;

  /**
   * Property password
   *
   * @description
   * Password of the account. A secret, never logged.
   *
   * @type {string | undefined}
   * @readonly
   */
  readonly password: string | undefined;

  /**
   * Property from
   *
   * @description
   * Sender address.
   *
   * @type {string}
   * @readonly
   */
  readonly from: string;

  /**
   * Property webAppUrl
   *
   * @description
   * Origin of the web application, for `List-Unsubscribe`.
   *
   * @type {string}
   * @readonly
   */
  readonly webAppUrl: string;
  // #endregion
}

/**
 * Constant SENDER_NAME
 *
 * @description
 * Display name of the sender. The mockup shows "Cadenway · Atelier Nord"; a code e-mail belongs to
 * an account, not to an organization, so it is "Cadenway" alone.
 *
 * @type {string}
 */
const SENDER_NAME: string = 'Cadenway';

/**
 * Constant MANAGE_NOTIFICATIONS_PATH
 *
 * @description
 * Path of Compte › Notifications in the web application, the target of `List-Unsubscribe` (the
 * "Gérer mes notifications" link of the Emails artboard).
 *
 * @type {string}
 */
const MANAGE_NOTIFICATIONS_PATH: string = '/account/notifications';

/**
 * Constant CONNECTION_TIMEOUT_MS
 *
 * @description
 * Time to open the connection and to receive the greeting, each, in milliseconds: an attempt of
 * the job lasts 60 seconds at most.
 *
 * @type {number}
 */
const CONNECTION_TIMEOUT_MS: number = 10_000;

/**
 * Constant SOCKET_TIMEOUT_MS
 *
 * @description
 * Inactivity after which the connection is closed, in milliseconds.
 *
 * @type {number}
 */
const SOCKET_TIMEOUT_MS: number = 30_000;

/**
 * Function readProperty
 *
 * @description
 * Reads one property of an unknown error without trusting its type.
 *
 * @param {unknown} error - The error.
 * @param {string} name - Name of the property.
 * @returns {unknown} Its value, or `undefined`.
 */
function readProperty(error: unknown, name: string): unknown {
  return typeof error === 'object' && error !== null && name in error
    ? (error as Readonly<Record<string, unknown>>)[name]
    : undefined;
}

/**
 * Class EmailNotSentError
 *
 * @description
 * The SMTP server is unreachable or refused an e-mail. Its message keeps the nodemailer error code,
 * the SMTP reply code and the SMTP command only: the original message may quote the recipient, and
 * the job stores the message of its failures.
 */
export class EmailNotSentError extends Error {
  // #region Constructor
  /**
   * Constructor
   *
   * @description
   * Describes an error of nodemailer without its message.
   *
   * @param {unknown} error - The error of nodemailer.
   * @constructor
   */
  public constructor(error: unknown) {
    const code: unknown = readProperty(error, 'code');
    const responseCode: unknown = readProperty(error, 'responseCode');
    const command: unknown = readProperty(error, 'command');
    const details: readonly string[] = [
      typeof code === 'string' ? `code ${code}` : '',
      typeof responseCode === 'number' ? `reply ${String(responseCode)}` : '',
      typeof command === 'string' ? `command ${command.split(' ')[0] ?? ''}` : '',
    ].filter((detail) => detail !== '');
    super(
      `The SMTP server did not accept the e-mail${details.length > 0 ? ` (${details.join(', ')})` : ''}.`,
    );
    this.name = 'EmailNotSentError';
  }
  // #endregion
}

/**
 * Class NodemailerEmailSender
 *
 * @description
 * Sends the e-mails through the SMTP server of the configuration with `nodemailer`: Mailpit
 * locally, the relay of the provider on a server. One connection per e-mail, closed with it.
 *
 * - Port 465 opens in TLS; another port upgrades with STARTTLS when offered, and requires it as
 *   soon as an account is set, so a password never crosses in clear.
 * - An e-mail that can be turned off carries `List-Unsubscribe`, to Compte › Notifications of the
 *   web application, and its one-click form `List-Unsubscribe-Post`; a security e-mail, always
 *   sent, carries neither (cw-email-templates).
 * - The `Message-ID` is derived from the id of the delivery, so two attempts of the same delivery
 *   send the same `Message-ID`.
 * - nodemailer logs nothing, and an error leaves with its codes only (`EmailNotSentError`): neither
 *   the address nor the content reaches a log or a stored job.
 */
export class NodemailerEmailSender
  implements EmailSender, SiteContactEmailSender, OnApplicationShutdown
{
  // #region Properties
  /**
   * Property transporter
   *
   * @description
   * The SMTP transport of nodemailer.
   *
   * @type {Transporter<SMTPSentMessageInfo>}
   * @readonly
   */
  private readonly transporter: Transporter<SMTPSentMessageInfo>;

  /**
   * Property from
   *
   * @description
   * Sender address.
   *
   * @type {string}
   * @readonly
   */
  private readonly from: string;

  /**
   * Property messageIdDomain
   *
   * @description
   * Right-hand side of the `Message-ID` of every e-mail: the domain of the sender address.
   *
   * @type {string}
   * @readonly
   */
  private readonly messageIdDomain: string;

  /**
   * Property unsubscribeUrl
   *
   * @description
   * Target of `List-Unsubscribe`.
   *
   * @type {string}
   * @readonly
   */
  private readonly unsubscribeUrl: string;
  // #endregion

  // #region Constructor
  /**
   * Constructor
   *
   * @description
   * Creates the transport. Nothing connects before the first e-mail.
   *
   * @param {SmtpSettings} settings - The SMTP server and the sender.
   * @constructor
   */
  public constructor(settings: SmtpSettings) {
    const authenticated: boolean = settings.user !== undefined && settings.password !== undefined;
    this.transporter = createTransport({
      host: settings.host,
      port: settings.port,
      secure: settings.port === 465,
      requireTLS: !settings.allowInsecureLocal && settings.port !== 465,
      tls: { rejectUnauthorized: true },
      ...(authenticated ? { auth: { user: settings.user, pass: settings.password } } : {}),
      connectionTimeout: CONNECTION_TIMEOUT_MS,
      greetingTimeout: CONNECTION_TIMEOUT_MS,
      socketTimeout: SOCKET_TIMEOUT_MS,
      logger: false,
      debug: false,
    });
    this.from = settings.from;
    this.messageIdDomain = settings.from.slice(settings.from.lastIndexOf('@') + 1);
    this.unsubscribeUrl = `${settings.webAppUrl}${MANAGE_NOTIFICATIONS_PATH}`;
  }
  // #endregion

  // #region Methods
  /**
   * Method send
   *
   * @description
   * Hands one e-mail to the SMTP server, with its text and HTML parts.
   *
   * @param {OutgoingEmail} email - The e-mail.
   * @returns {Promise<void>} Settles once the server accepted it.
   * @throws {EmailNotSentError} When the server is unreachable or refuses it.
   */
  public async send(email: OutgoingEmail): Promise<void> {
    try {
      await this.transporter.sendMail({
        from: { name: SENDER_NAME, address: this.from },
        to:
          email.to.name === ''
            ? email.to.address
            : { name: email.to.name, address: email.to.address },
        subject: email.subject,
        text: email.text,
        html: email.html,
        messageId: `<${email.id}@${this.messageIdDomain}>`,
        headers: email.unsubscribe
          ? {
              'List-Unsubscribe': `<${this.unsubscribeUrl}>`,
              'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click',
            }
          : {},
        // The content is built by the templates only: nothing may make nodemailer read a file or
        // fetch a URL.
        disableFileAccess: true,
        disableUrlAccess: true,
      });
    } catch (error) {
      throw new EmailNotSentError(error);
    }
  }

  /** Delivers one plain-text contact message with a server-controlled envelope and subject. */
  public async sendSiteContact(input: SendSiteContactEmailInput): Promise<void> {
    try {
      await this.transporter.sendMail({
        from: { name: SENDER_NAME, address: this.from },
        to: { name: '', address: input.supportAddress },
        replyTo: { name: '', address: input.replyTo },
        subject: siteContactSubjects[input.subject],
        text: input.message,
        messageId: `<${input.submissionId}@${this.messageIdDomain}>`,
        disableFileAccess: true,
        disableUrlAccess: true,
      });
    } catch (error) {
      throw new EmailNotSentError(error);
    }
  }

  /**
   * Method onApplicationShutdown
   *
   * @description
   * Closes the transport when the application stops.
   */
  public onApplicationShutdown(): void {
    this.transporter.close();
  }
  // #endregion
}
