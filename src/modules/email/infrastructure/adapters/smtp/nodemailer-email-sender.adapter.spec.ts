import { createTransport } from 'nodemailer';
import { describe, expect, it, vi } from 'vitest';

import { EmailNotSentError, NodemailerEmailSender } from './nodemailer-email-sender.adapter.js';

vi.mock('nodemailer', () => ({ createTransport: vi.fn() }));

describe('SMTP transport security', () => {
  it.each([
    { port: 465, allowInsecureLocal: false, secure: true, requireTLS: false },
    { port: 587, allowInsecureLocal: false, secure: false, requireTLS: true },
    { port: 1025, allowInsecureLocal: true, secure: false, requireTLS: false },
  ])('configures TLS for port $port and the validated development exception', (mode) => {
    new NodemailerEmailSender({
      host: mode.allowInsecureLocal ? 'mailpit' : 'smtp.example.test',
      port: mode.port,
      allowInsecureLocal: mode.allowInsecureLocal,
      user: undefined,
      password: undefined,
      from: 'sender@example.test',
      webAppUrl: 'https://app.example.test',
    });

    expect(createTransport).toHaveBeenLastCalledWith(
      expect.objectContaining({
        secure: mode.secure,
        requireTLS: mode.requireTLS,
        tls: { rejectUnauthorized: true },
      }),
    );
  });
});

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
