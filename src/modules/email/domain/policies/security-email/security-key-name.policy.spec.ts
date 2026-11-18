import { describe, expect, it } from 'vitest';
import { shownSecurityKeyName } from './security-key-name.policy.js';

describe('shownSecurityKeyName', () => {
  it.each([
    'YubiKey 5C NFC',
    'Touch ID (MacBook Air)',
    'Clé de Camille',
    'Camille’s key',
    'YubiKey 5 NFC #2',
    'Galaxy S24 Ultra',
    'Clé v1.2',
    '1Password',
  ])('shows a name that looks like the name of a device: %j', (name) => {
    expect(shownSecurityKeyName(name)).toBe(name);
  });

  it.each([
    ['a domain', 'cadenway-support.example'],
    ['a domain whose label ends with a digit', 'Support cadenway-aide1.com'],
    ['a bare domain with a digit', 'cadenway2.fr'],
    ['a host name', 'www1.evil1.com'],
    ['part of a phone number', 'Appelez le 01 23 45'],
    ['a short phone number', 'Appelez le 118 218'],
    ['a model and a year', 'Galaxy S24 (2023)'],
    ['an address', 'support@cadenway.example'],
    ['a link', 'https://evil.example'],
    ['a phone number', 'Appelez le 0612345678'],
    ['a phone number with spaces', 'Appelez le 06 12 34 56 78'],
    ['a sentence with other signs', 'Urgent ! Rappelez-nous'],
    ['markup', '<b>YubiKey</b>'],
    ['a name that starts with a sign', '-YubiKey'],
    ['an empty name', ''],
    ['a name longer than the contract allows', 'Y'.repeat(61)],
  ])('names no key for %s', (_kind, name) => {
    expect(shownSecurityKeyName(name)).toBeNull();
  });

  it('names no key when the event names none', () => {
    expect(shownSecurityKeyName(null)).toBeNull();
  });
});
