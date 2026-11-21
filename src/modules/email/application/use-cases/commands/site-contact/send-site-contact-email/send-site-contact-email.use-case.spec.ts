import { describe, expect, it, vi } from 'vitest';

import { SendSiteContactEmail } from './send-site-contact-email.use-case.js';

describe('SendSiteContactEmail', () => {
  it('preserves the submission identity and support delivery fields on retries', async () => {
    const sendSiteContact = vi.fn().mockResolvedValue(undefined);
    const action = new SendSiteContactEmail({ sendSiteContact });
    const input = {
      submissionId: '019a7000-1a2b-7c3d-8e4f-5a6b7c8d9e01',
      supportAddress: 'support@example.test',
      replyTo: 'camille@example.test',
      subject: 'login',
      message: 'Je ne peux plus me connecter.',
    } as const;

    await action.execute(input);
    await action.execute(input);

    expect(sendSiteContact).toHaveBeenCalledTimes(2);
    expect(sendSiteContact).toHaveBeenNthCalledWith(1, input);
    expect(sendSiteContact).toHaveBeenNthCalledWith(2, input);
  });

  it('propagates transport failure to the delivery worker', async () => {
    const failure = new Error('SMTP unavailable');
    const action = new SendSiteContactEmail({
      sendSiteContact: vi.fn().mockRejectedValue(failure),
    });

    await expect(
      action.execute({
        submissionId: '019a7000-1a2b-7c3d-8e4f-5a6b7c8d9e01',
        supportAddress: 'support@example.test',
        replyTo: 'camille@example.test',
        subject: 'other',
        message: 'Je souhaite contacter le support.',
      }),
    ).rejects.toBe(failure);
  });
});
