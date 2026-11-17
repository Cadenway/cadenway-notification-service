import { inspect } from 'node:util';
import { describe, expect, it } from 'vitest';
import { InvalidResetLinkTokenError } from '../../errors/security-email/invalid-reset-link-token.error.js';
import { ResetLinkToken } from './reset-link-token.value-object.js';

/**
 * Constant TOKEN
 *
 * @description
 * A token of the shape identity-service issues, made up for the tests.
 *
 * @type {string}
 */
const TOKEN: string = 'rT7kQ2xVb9Lm4Np8Zc1Hs6Wd3Fg5Jy0A_-uE';

describe('ResetLinkToken', () => {
  it('gives back the secret as it was issued', () => {
    expect(ResetLinkToken.of(TOKEN).reveal()).toBe(TOKEN);
  });

  it.each([
    'short',
    'a'.repeat(31),
    'a'.repeat(129),
    `${'a'.repeat(32)}=`,
    `${'a'.repeat(32)}/`,
    `${'a'.repeat(32)} `,
    '',
  ])('refuses %j, which is not 32 to 128 URL-safe characters, without quoting it', (value) => {
    expect(() => ResetLinkToken.of(value)).toThrow(InvalidResetLinkTokenError);
    try {
      ResetLinkToken.of(value);
    } catch (error) {
      expect((error as Error).message).toBe('A reset link token is 32 to 128 URL-safe characters.');
    }
  });

  it('accepts the bounds of the contract', () => {
    expect(ResetLinkToken.of('a'.repeat(32)).reveal()).toHaveLength(32);
    expect(ResetLinkToken.of('b'.repeat(128)).reveal()).toHaveLength(128);
  });

  it('never prints its secret when it is logged, serialized or interpolated by mistake', () => {
    const token: ResetLinkToken = ResetLinkToken.of(TOKEN);

    expect(String(token)).toBe('[reset link token]');
    expect(`link ${String(token)}`).toBe('link [reset link token]');
    expect(JSON.stringify({ token })).toBe('{"token":"[reset link token]"}');
    expect(inspect(token)).not.toContain(TOKEN);
    expect(Object.values(token)).toEqual([]);
  });
});
