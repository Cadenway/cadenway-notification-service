import { InvalidSiteFormError } from '../../errors/forms/invalid-site-form.error.js';

// Match the single mailbox validated by the PublicSiteEmail schema.
const mailboxPattern =
  /^(?:[A-Za-z0-9_'+-]+\.)*[A-Za-z0-9_'+-]*[A-Za-z0-9_+-]@(?:[A-Za-z0-9][A-Za-z0-9-]*\.)+[A-Za-z]{2,}$/u;

/** A single public site mailbox as defined by components/public-site.yaml in API Contracts. */
export class PublicSiteMailbox {
  // #region Properties
  /** Original address, kept out of implicit serialization and inspection. */
  readonly #address: string;
  // #endregion

  // #region Constructor
  /** Holds the address already accepted by the factory. */
  private constructor(address: string) {
    this.#address = address;
  }
  // #endregion

  // #region Methods
  /** Accepts one address of up to 254 characters without surrounding whitespace. */
  public static of(address: string): PublicSiteMailbox {
    if (address.length > 254 || address.trim() !== address || !mailboxPattern.test(address)) {
      throw new InvalidSiteFormError('email');
    }
    return new PublicSiteMailbox(address);
  }

  /** Explicitly reads the original address for the contact message's Reply-To header. */
  public address(): string {
    return this.#address;
  }

  /** Uses only domain case folding for newsletter deduplication, as required by Notification's internal contract. */
  public subscriptionIdentity(): string {
    const domainStart = this.#address.indexOf('@') + 1;
    return this.#address.slice(0, domainStart) + this.#address.slice(domainStart).toLowerCase();
  }
  // #endregion
}
