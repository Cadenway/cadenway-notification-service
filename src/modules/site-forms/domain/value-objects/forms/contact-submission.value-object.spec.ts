import { inspect } from 'node:util';
import { describe, expect, it } from 'vitest';

import { InvalidSiteFormError } from '../../errors/forms/invalid-site-form.error.js';
import { ContactSubmission } from './contact-submission.value-object.js';

const replyTo = 'Camille.Martin@AtelierNord.FR';
const message = '  Je souhaite récupérer\nl’accès à mon compte.  ';

describe('ContactSubmission', () => {
  it.each(['login', 'mfa', 'org', 'data', 'other'])(
    'accepts the supported topic %s and keeps the plain text exactly as submitted',
    (subject) => {
      const contact = ContactSubmission.of({ email: replyTo, subject, message });

      expect(contact.subject()).toBe(subject);
      expect(contact.message()).toBe(message);
      expect(contact.replyTo().address()).toBe(replyTo);
    },
  );

  it.each(['support', 'Login', ' login ', 'login\r\nCc: visitor@example.fr'])(
    'rejects a topic outside the fixed contact form categories',
    (subject) => {
      expect(() => ContactSubmission.of({ email: replyTo, subject, message })).toThrow(
        expect.objectContaining({ name: 'InvalidSiteFormError', field: 'subject' }),
      );
    },
  );

  it('counts Unicode code points and checks the minimum after trimming surrounding whitespace', () => {
    const twenty = `\u00a0${'😀'.repeat(20)} \n`;
    const nineteen = ` ${'😀'.repeat(19)}   `;
    const subject = 'login';

    expect(ContactSubmission.of({ email: replyTo, subject, message: twenty }).message()).toBe(
      twenty,
    );
    expect(() => ContactSubmission.of({ email: replyTo, subject, message: nineteen })).toThrow(
      expect.objectContaining({ name: 'InvalidSiteFormError', field: 'message' }),
    );
    expect(() =>
      ContactSubmission.of({ email: replyTo, subject, message: ' '.repeat(40) }),
    ).toThrow(InvalidSiteFormError);
  });

  it('counts surrounding whitespace toward the 2000 code point maximum', () => {
    const maximum = ` ${'😀'.repeat(1999)}`;
    const subject = 'data';

    expect(ContactSubmission.of({ email: replyTo, subject, message: maximum }).message()).toBe(
      maximum,
    );
    expect(() => ContactSubmission.of({ email: replyTo, subject, message: `${maximum} ` })).toThrow(
      expect.objectContaining({ name: 'InvalidSiteFormError', field: 'message' }),
    );
  });

  it('keeps form data away from implicit inspection, serialization and errors', () => {
    const contact = ContactSubmission.of({ email: replyTo, subject: 'org', message });

    expect(JSON.stringify(contact)).toBe('{}');
    expect(inspect(contact)).not.toContain(replyTo);
    expect(inspect(contact)).not.toContain(message);
    expect(() => ContactSubmission.of({ email: replyTo, subject: replyTo, message })).toThrow(
      /^Invalid contact topic\.$/u,
    );
    expect(() =>
      ContactSubmission.of({ email: replyTo, subject: 'login', message: replyTo.slice(0, 10) }),
    ).toThrow(/^Invalid contact message length\.$/u);
  });
});
