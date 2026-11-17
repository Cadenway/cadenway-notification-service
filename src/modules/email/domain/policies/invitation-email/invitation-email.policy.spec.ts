import { describe, expect, it } from 'vitest';
import { InvalidInvitationExpiryError } from '../../errors/invitation-email/invalid-invitation-expiry.error.js';
import { InvitationValidity } from '../../value-objects/invitation-email/invitation-validity.value-object.js';
import { decideInvitationEmail } from './invitation-email.policy.js';

/**
 * Constant issuedAt
 *
 * @description
 * When Hugo Durand sent the invitation of the mockup.
 *
 * @type {Date}
 */
const issuedAt: Date = new Date('2026-11-09T09:15:00.000Z');

/**
 * Constant expiresAt
 *
 * @description
 * Seven days later, the 16 November 2026 of the mockup.
 *
 * @type {Date}
 */
const expiresAt: Date = new Date('2026-11-16T09:15:00.000Z');

describe('InvitationValidity', () => {
  it('expires at its expiry instant, as organization-service refuses it from then on', () => {
    const validity: InvitationValidity = InvitationValidity.between(issuedAt, expiresAt);

    expect(validity.isExpiredAt(new Date(expiresAt.getTime() - 1))).toBe(false);
    expect(validity.isExpiredAt(expiresAt)).toBe(true);
  });

  it('accepts the 7 days of the contract, and a day more for the clocks', () => {
    expect(() =>
      InvitationValidity.between(issuedAt, new Date(issuedAt.getTime() + 8 * 86_400_000)),
    ).not.toThrow();
  });

  it('refuses an invitation that does not expire after it was sent, within 8 days', () => {
    expect(() => InvitationValidity.between(expiresAt, issuedAt)).toThrow(
      InvalidInvitationExpiryError,
    );
    expect(() => InvitationValidity.between(issuedAt, issuedAt)).toThrow(
      InvalidInvitationExpiryError,
    );
    expect(() =>
      InvitationValidity.between(issuedAt, new Date(issuedAt.getTime() + 8 * 86_400_000 + 1)),
    ).toThrow(InvalidInvitationExpiryError);
    expect(() =>
      InvitationValidity.between(issuedAt, new Date('9999-12-31T00:00:00.000Z')),
    ).toThrow(InvalidInvitationExpiryError);
    expect(() => InvitationValidity.between(issuedAt, new Date(Number.NaN))).toThrow(
      InvalidInvitationExpiryError,
    );
  });

  it('keeps its own copy of the instants', () => {
    const end: Date = new Date(expiresAt.getTime());
    const validity: InvitationValidity = InvitationValidity.between(issuedAt, end);

    end.setTime(0);

    expect(validity.expiresAt).toEqual(expiresAt);
  });
});

describe('decideInvitationEmail', () => {
  const validity: InvitationValidity = InvitationValidity.between(issuedAt, expiresAt);

  it('sends the e-mail of the latest version of a valid invitation', () => {
    expect(decideInvitationEmail(true, validity, issuedAt)).toEqual({ kind: 'send' });
  });

  it('skips an invitation that expired before its e-mail could leave', () => {
    expect(decideInvitationEmail(true, validity, expiresAt)).toEqual({
      kind: 'skip',
      reason: 'expired',
    });
  });

  it('skips a version older than one already received: only the latest one is sent', () => {
    expect(decideInvitationEmail(false, validity, issuedAt)).toEqual({
      kind: 'skip',
      reason: 'superseded',
    });
    expect(decideInvitationEmail(false, validity, expiresAt)).toEqual({
      kind: 'skip',
      reason: 'superseded',
    });
  });
});
