import { describe, expect, it } from 'vitest';

import { EmailNotSentError } from './nodemailer-email-sender.js';

describe('EmailNotSentError', () => {
  it('keeps the codes of an SMTP refusal and drops its message, which quotes the recipient', () => {
    const refusal: Error = Object.assign(
      new Error(
        "Can't send mail - all recipients were rejected: 550 5.1.1 <camille.martin@ateliernord.fr>: Recipient address rejected",
      ),
      { code: 'EENVELOPE', responseCode: 550, command: 'RCPT TO:<camille.martin@ateliernord.fr>' },
    );

    const error: EmailNotSentError = new EmailNotSentError(refusal);

    expect(error.name).toBe('EmailNotSentError');
    expect(error.message).toBe(
      'The SMTP server did not accept the e-mail (code EENVELOPE, reply 550, command RCPT).',
    );
    expect(error.message).not.toContain('camille.martin');
    expect(error.cause).toBeUndefined();
  });

  it('describes an error without codes in general terms', () => {
    expect(new EmailNotSentError(new Error('socket hang up')).message).toBe(
      'The SMTP server did not accept the e-mail.',
    );
    expect(new EmailNotSentError('unexpected').message).toBe(
      'The SMTP server did not accept the e-mail.',
    );
  });
});
