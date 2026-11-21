import { PublicSiteMailbox } from '../../../../../domain/value-objects/forms/public-site-mailbox.value-object.js';
import type { NewsletterSubscriptionUnitOfWork } from '../../../../ports/outbound/transactions/forms/newsletter-subscription-unit-of-work.port.js';
import type { SubscribeNewsletterInput } from './subscribe-newsletter.input.js';
import type { SubscribeNewsletterOutput } from './subscribe-newsletter.output.js';

/** Records a public newsletter signup without changing an existing subscription. */
export class SubscribeNewsletter {
  // #region Constructor
  /** Uses a system transaction because public forms have no organization. */
  public constructor(private readonly work: NewsletterSubscriptionUnitOfWork) {}
  // #endregion

  // #region Methods
  /** Normalizes only the domain and returns a generic receipt after durable storage. */
  public async execute(input: SubscribeNewsletterInput): Promise<SubscribeNewsletterOutput> {
    const mailbox = PublicSiteMailbox.of(input.email).subscriptionIdentity();
    await this.work.run((transaction) => transaction.insertIfAbsent(mailbox));
    return 'accepted';
  }
  // #endregion
}
