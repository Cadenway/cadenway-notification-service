import { inspect } from 'node:util';
import { describe, expect, it } from 'vitest';
import { InvalidOneTimeCodeError } from '../../errors/code-email/invalid-one-time-code.error.js';
import { OneTimeCode } from './one-time-code.value-object.js';

describe('OneTimeCode', () => {
  it('shows the 6 digits in two groups of three, as the mockup does', () => {
    expect(OneTimeCode.of('482913').display()).toBe('482 913');
  });

  it('gives back the digits as they were issued', () => {
    expect(OneTimeCode.of('004213').reveal()).toBe('004213');
  });

  it.each(['48291', '4829134', '48 913', 'abcdef', '', '４８２９１３'])(
    'refuses %j, which is not exactly 6 digits, without quoting it',
    (digits) => {
      expect(() => OneTimeCode.of(digits)).toThrow(InvalidOneTimeCodeError);
      try {
        OneTimeCode.of(digits);
      } catch (error) {
        expect((error as Error).message).toBe('A one-time code is exactly 6 digits.');
      }
    },
  );

  it('never prints its digits when it is logged, serialized or interpolated by mistake', () => {
    const code: OneTimeCode = OneTimeCode.of('482913');

    expect(String(code)).toBe('[one-time code]');
    expect(`code ${String(code)}`).toBe('code [one-time code]');
    expect(JSON.stringify({ code })).toBe('{"code":"[one-time code]"}');
    expect(inspect(code)).not.toContain('482913');
    expect(Object.values(code)).toEqual([]);
  });
});
