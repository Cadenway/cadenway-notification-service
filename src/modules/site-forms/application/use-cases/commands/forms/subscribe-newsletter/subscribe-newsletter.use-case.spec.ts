import { describe, expect, it, vi } from 'vitest';

import type { NewsletterSubscriptionTransaction } from '../../../../ports/outbound/transactions/forms/newsletter-subscription-transaction.port.js';
import type { NewsletterSubscriptionUnitOfWork } from '../../../../ports/outbound/transactions/forms/newsletter-subscription-unit-of-work.port.js';
import { SubscribeNewsletter } from './subscribe-newsletter.use-case.js';

describe('SubscribeNewsletter', () => {
  it('preserves the local part and inserts the canonical domain through a system transaction', async () => {
    const insertIfAbsent = vi
      .fn<NewsletterSubscriptionTransaction['insertIfAbsent']>()
      .mockResolvedValue();
    const run = vi.fn();
    const work: NewsletterSubscriptionUnitOfWork = {
      run: (callback) => {
        run();
        return callback({ insertIfAbsent });
      },
    };
    const command = new SubscribeNewsletter(work);
    await expect(command.execute({ email: 'Camille@EXAMPLE.FR' })).resolves.toBe('accepted');
    expect(insertIfAbsent).toHaveBeenCalledExactlyOnceWith('Camille@example.fr');
    expect(run).toHaveBeenCalledOnce();
  });

  it('returns a generic receipt for a repeated address and keeps its previous state', async () => {
    const records = new Map([['Camille@example.fr', 'unsubscribed']]);
    const insertIfAbsent: NewsletterSubscriptionTransaction['insertIfAbsent'] = (mailbox) => {
      if (!records.has(mailbox)) records.set(mailbox, 'subscribed');
      return Promise.resolve();
    };
    const work: NewsletterSubscriptionUnitOfWork = {
      run: async (callback) => callback({ insertIfAbsent }),
    };
    const command = new SubscribeNewsletter(work);
    await expect(command.execute({ email: 'Camille@EXAMPLE.FR' })).resolves.toBe('accepted');
    expect(records.get('Camille@example.fr')).toBe('unsubscribed');
  });

  it('propagates storage failures and does not return acceptance', async () => {
    const insertIfAbsent = vi
      .fn<NewsletterSubscriptionTransaction['insertIfAbsent']>()
      .mockRejectedValue(new Error('Storage unavailable'));
    const command = new SubscribeNewsletter({
      run: async (callback) => callback({ insertIfAbsent }),
    });
    await expect(command.execute({ email: 'camille@example.fr' })).rejects.toThrow(
      'Storage unavailable',
    );
  });
});
