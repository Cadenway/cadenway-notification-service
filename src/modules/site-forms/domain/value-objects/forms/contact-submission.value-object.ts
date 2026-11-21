import { InvalidSiteFormError } from '../../errors/forms/invalid-site-form.error.js';
import { PublicSiteMailbox } from './public-site-mailbox.value-object.js';

const contactSubjects = ['login', 'mfa', 'org', 'data', 'other'] as const;
const minimumMessageLength = 20;
const maximumMessageLength = 2_000;

type ContactSubject = (typeof contactSubjects)[number];

/**
 * Validated input for a plain-text message to the configured support mailbox.
 * The supported topics and Unicode lengths follow components/public-site.yaml in API Contracts.
 */
export class ContactSubmission {
  // #region Properties
  /** Visitor address for the support message's Reply-To header. */
  readonly #replyTo: PublicSiteMailbox;

  /** Topic that selects a server-controlled subject label. */
  readonly #subject: ContactSubject;

  /** Message text as received, including line breaks and surrounding whitespace. */
  readonly #message: string;
  // #endregion

  // #region Constructor
  /** Holds a validated reply address, topic and message. */
  private constructor(replyTo: PublicSiteMailbox, subject: ContactSubject, message: string) {
    this.#replyTo = replyTo;
    this.#subject = subject;
    this.#message = message;
  }
  // #endregion

  // #region Methods
  /** Validates the fixed topic, the code-point limits and the Reply-To address. */
  public static of(input: {
    readonly email: string;
    readonly subject: string;
    readonly message: string;
  }): ContactSubmission {
    const replyTo = PublicSiteMailbox.of(input.email);
    const subject = contactSubjects.find((candidate) => candidate === input.subject);
    if (subject === undefined) throw new InvalidSiteFormError('subject');

    const { message } = input;
    if (
      message.length > maximumMessageLength * 2 ||
      Array.from(message).length > maximumMessageLength ||
      Array.from(message.trim()).length < minimumMessageLength
    ) {
      throw new InvalidSiteFormError('message');
    }

    return new ContactSubmission(replyTo, subject, message);
  }

  /** Provides the validated visitor address for Reply-To only. */
  public replyTo(): PublicSiteMailbox {
    return this.#replyTo;
  }

  /** Provides the fixed topic used by the support delivery adapter. */
  public subject(): ContactSubject {
    return this.#subject;
  }

  /** Reads the unmodified text for support delivery. */
  public message(): string {
    return this.#message;
  }
  // #endregion
}
