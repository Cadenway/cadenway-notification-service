import { describe, expect, it } from 'vitest';
import {
  knownDeviceType,
  shownDeviceName,
  shownIpAddress,
  shownVersion,
} from './client-text.policy.js';

describe('knownDeviceType', () => {
  it.each(['desktop', 'mobile', 'tablet'])('keeps the type %s of the contract', (type) => {
    expect(knownDeviceType(type)).toBe(type);
  });

  it.each(['unknown', 'watch', 'constructor', '__proto__', ''])(
    'reads %j as unknown, as the contract asks',
    (type) => {
      expect(knownDeviceType(type)).toBe('unknown');
    },
  );
});

describe('shownDeviceName', () => {
  it.each([
    'Firefox',
    'Safari',
    'Microsoft Edge',
    'Samsung Internet',
    'Chrome OS',
    'Windows',
    'macOS',
    'iOS',
    'Opera 100',
  ])('shows the product name %j', (name) => {
    expect(shownDeviceName(name)).toBe(name);
  });

  it.each([
    'evil.example',
    'cadenway1.fr',
    'Support aide2.example',
    'Appelez le 0612345678',
    '06 12 34 56 78',
    'https://phishing',
    'support@cadenway',
    'Firefox, et votre mot de passe expire',
    '42 Browser',
    'x'.repeat(41),
  ])('shows nothing for %j, which does not look like a product name', (name) => {
    expect(shownDeviceName(name)).toBeNull();
  });

  it('shows nothing when the event has no name', () => {
    expect(shownDeviceName(null)).toBeNull();
  });
});

describe('shownVersion', () => {
  it.each(['11', '18.1', '10.15.7'])('shows the version %j', (version) => {
    expect(shownVersion(version)).toBe(version);
  });

  it.each(['Vista', '18.1 beta', '1.2.3.4.5', '123456', null])(
    'shows nothing for %j',
    (version) => {
      expect(shownVersion(version)).toBeNull();
    },
  );
});

describe('shownIpAddress', () => {
  it.each(['192.0.2.14', '86.247.12.30', '2001:db8::1', '::ffff:192.0.2.14'])(
    'shows the address %j',
    (address) => {
      expect(shownIpAddress(address)).toBe(address);
    },
  );

  it.each(['256.0.2.14', '192.0.2', 'localhost', 'evil.example', 'abc:def', '06 12 34 56 78'])(
    'shows nothing for %j, which is not an IP address',
    (address) => {
      expect(shownIpAddress(address)).toBeNull();
    },
  );
});
