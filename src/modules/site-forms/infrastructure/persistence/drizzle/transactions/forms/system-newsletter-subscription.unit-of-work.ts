import type { SystemTransactionRunner } from '@cadenway/nest-common/database';

import type { NewsletterSubscriptionTransaction } from '../../../../../application/ports/outbound/transactions/forms/newsletter-subscription-transaction.port.js';
import type { NewsletterSubscriptionUnitOfWork } from '../../../../../application/ports/outbound/transactions/forms/newsletter-subscription-unit-of-work.port.js';
import { siteNewsletterSubscriptions } from '../../schemas/forms/site-newsletter.schema.js';

/** Persists global newsletter subscriptions without changing an existing signup. */
export class SystemNewsletterSubscriptionUnitOfWork implements NewsletterSubscriptionUnitOfWork {
  // #region Constructor
  /** Binds the runner for newsletter records with no organization. */
  public constructor(private readonly system: SystemTransactionRunner) {}
  // #endregion

  // #region Methods
  /** Commits the operation while preserving the existing row on a canonical mailbox conflict. */
  public run<T>(work: (transaction: NewsletterSubscriptionTransaction) => Promise<T>): Promise<T> {
    return this.system.run(({ db }) =>
      work({
        insertIfAbsent: async (mailbox) => {
          await db
            .insert(siteNewsletterSubscriptions)
            .values({ mailbox })
            .onConflictDoNothing({ target: siteNewsletterSubscriptions.mailbox });
        },
      }),
    );
  }
  // #endregion
}
