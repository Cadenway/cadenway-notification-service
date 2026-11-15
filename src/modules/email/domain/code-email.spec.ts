import { fc, test } from '@fast-check/vitest';
import { describe, expect, it } from 'vitest';

import { CodeValidity, codeEmailTemplateFor, decideCodeEmail } from './code-email.js';
import type { CodeEmailPurpose } from './code-email.js';
import { InvalidCodeValidityError } from './errors.js';

/**
 * Constant issuedAt
 *
 * @description
 * When Camille Martin asked for her code in the mockup: 9 November 2026, 14:07 in Paris.
 *
 * @type {Date}
 */
const issuedAt: Date = new Date('2026-11-09T13:07:00.000Z');

/**
 * Constant expiresAt
 *
 * @description
 * Ten minutes later, when the code stops working.
 *
 * @type {Date}
 */
const expiresAt: Date = new Date('2026-11-09T13:17:00.000Z');

describe('CodeValidity', () => {
  it('says how long the code is valid, in whole minutes: 10 for a sign-in code', () => {
    expect(CodeValidity.between(issuedAt, expiresAt).minutes).toBe(10);
  });

  it('rounds a few milliseconds between the two instants of the event', () => {
    const late: Date = new Date(issuedAt.getTime() + 25);

    expect(CodeValidity.between(late, expiresAt).minutes).toBe(10);
  });

  it('counts at least one minute', () => {
    expect(CodeValidity.between(issuedAt, new Date(issuedAt.getTime() + 1_000)).minutes).toBe(1);
  });

  it('refuses a code that expires when or before it was issued', () => {
    expect(() => CodeValidity.between(expiresAt, issuedAt)).toThrow(InvalidCodeValidityError);
    expect(() => CodeValidity.between(issuedAt, issuedAt)).toThrow(InvalidCodeValidityError);
    expect(() => CodeValidity.between(new Date(Number.NaN), expiresAt)).toThrow(
      InvalidCodeValidityError,
    );
  });

  it('keeps its own copy of the instants', () => {
    const end: Date = new Date(expiresAt.getTime());
    const validity: CodeValidity = CodeValidity.between(issuedAt, end);

    end.setTime(0);

    expect(validity.expiresAt).toEqual(expiresAt);
  });

  it('expires at its expiry instant, as identity-service refuses it from then on', () => {
    const validity: CodeValidity = CodeValidity.between(issuedAt, expiresAt);

    expect(validity.isExpiredAt(new Date(expiresAt.getTime() - 1))).toBe(false);
    expect(validity.isExpiredAt(expiresAt)).toBe(true);
  });

  test.prop([fc.integer({ min: 1, max: 86_400_000 }), fc.integer({ min: -1e9, max: 1e9 })])(
    'is expired exactly from its expiry on, whatever its length and the instant',
    (lengthMs, offsetMs) => {
      const validity: CodeValidity = CodeValidity.between(
        issuedAt,
        new Date(issuedAt.getTime() + lengthMs),
      );
      const now: Date = new Date(validity.expiresAt.getTime() + offsetMs);

      expect(validity.isExpiredAt(now)).toBe(offsetMs >= 0);
    },
  );
});

describe('decideCodeEmail', () => {
  const validity: CodeValidity = CodeValidity.between(issuedAt, expiresAt);
  const beforeExpiry: Date = new Date('2026-11-09T13:08:00.000Z');

  it('sends the "Confirmation de l’adresse" e-mail for a sign-up code', () => {
    expect(decideCodeEmail('email-verification', validity, beforeExpiry)).toEqual({
      kind: 'send',
      template: 'email-verification',
    });
  });

  it('sends the "Code de connexion" e-mail for a sign-in code', () => {
    expect(decideCodeEmail('sign-in', validity, beforeExpiry)).toEqual({
      kind: 'send',
      template: 'sign-in',
    });
  });

  it('skips a code that already expired', () => {
    expect(decideCodeEmail('sign-in', validity, expiresAt)).toEqual({
      kind: 'skip',
      reason: 'expired',
    });
  });

  it('skips an address-change code: its e-mail comes with address changes', () => {
    expect(decideCodeEmail('email-change', validity, beforeExpiry)).toEqual({
      kind: 'skip',
      reason: 'purpose-not-supported',
    });
  });

  it.each<[CodeEmailPurpose, string | null]>([
    ['email-verification', 'email-verification'],
    ['sign-in', 'sign-in'],
    ['email-change', null],
  ])('gives %s the template %s', (purpose, template) => {
    expect(codeEmailTemplateFor(purpose)).toBe(template);
  });
});
