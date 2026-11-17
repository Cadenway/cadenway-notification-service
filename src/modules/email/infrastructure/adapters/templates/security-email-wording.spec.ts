import { describe, expect, it } from 'vitest';
import type { SecurityEmailClient } from '../../../application/models/security-email/security-email-client.model.js';
import {
  closedSessionsLabel,
  dateTimeLabel,
  dayLabel,
  dayMonthLabel,
  delayLabel,
  deviceLabel,
  shortDateTimeLabel,
  subjectDevice,
} from './security-email-wording.js';

/**
 * Constant firefoxOnWindows
 *
 * @description
 * The browser of Camille Martin in the mockup: Firefox on Windows, whose version the `User-Agent`
 * does not tell reliably.
 *
 * @type {SecurityEmailClient}
 */
const firefoxOnWindows: SecurityEmailClient = {
  deviceType: 'desktop',
  browser: 'Firefox',
  os: 'Windows',
  osVersion: null,
  ipAddress: '192.0.2.14',
};

describe('dateTimeLabel', () => {
  it('dates an instant in Paris as the mockup does: "9 novembre 2026 à 14:07 (heure de Paris)"', () => {
    expect(dateTimeLabel(new Date('2026-11-09T13:07:00.000Z'), 'Europe/Paris')).toBe(
      '9 novembre 2026 à 14:07 (heure de Paris)',
    );
  });

  it('follows summer time in Paris', () => {
    expect(dateTimeLabel(new Date('2026-07-14T08:05:00.000Z'), 'Europe/Paris')).toBe(
      '14 juillet 2026 à 10:05 (heure de Paris)',
    );
  });

  it('dates an instant in the time zone of the account, named by its offset', () => {
    expect(dateTimeLabel(new Date('2026-11-09T13:07:00.000Z'), 'America/New_York')).toBe(
      '9 novembre 2026 à 08:07 (UTC−5)',
    );
    expect(dateTimeLabel(new Date('2026-11-09T13:07:00.000Z'), 'UTC')).toBe(
      '9 novembre 2026 à 13:07 (UTC)',
    );
  });

  it('reads a time zone the runtime does not know as Paris', () => {
    expect(dateTimeLabel(new Date('2026-11-09T13:07:00.000Z'), 'Mars/Olympus_Mons')).toBe(
      '9 novembre 2026 à 14:07 (heure de Paris)',
    );
  });

  it('writes the first of the month as "1er" and midnight on 24 hours', () => {
    expect(dateTimeLabel(new Date('2026-11-30T23:00:00.000Z'), 'Europe/Paris')).toBe(
      '1er décembre 2026 à 00:00 (heure de Paris)',
    );
  });
});

describe('shortDateTimeLabel, dayLabel and dayMonthLabel', () => {
  it('drop the year or the time as the preheaders and headings of the mockup do', () => {
    const instant: Date = new Date('2026-11-09T07:42:00.000Z');

    expect(shortDateTimeLabel(instant, 'Europe/Paris')).toBe('9 novembre à 08:42');
    expect(dayLabel(new Date('2026-12-09T15:30:00.000Z'), 'Europe/Paris')).toBe('9 décembre 2026');
    expect(dayMonthLabel(new Date('2026-12-09T15:30:00.000Z'), 'Europe/Paris')).toBe('9 décembre');
  });

  it('take the day in the time zone of the account', () => {
    const instant: Date = new Date('2026-12-09T23:30:00.000Z');

    expect(dayLabel(instant, 'Europe/Paris')).toBe('10 décembre 2026');
    expect(dayLabel(instant, 'America/New_York')).toBe('9 décembre 2026');
  });
});

describe('delayLabel', () => {
  it('counts the days until the deletion: "30 jours", "1 jour"', () => {
    const from: Date = new Date('2026-11-09T15:30:00.000Z');

    expect(delayLabel(from, new Date('2026-12-09T15:30:00.000Z'))).toBe('30 jours');
    expect(delayLabel(from, new Date('2026-11-10T15:30:00.000Z'))).toBe('1 jour');
    expect(delayLabel(from, new Date('2026-11-09T16:30:00.000Z'))).toBe('1 jour');
  });
});

describe('deviceLabel', () => {
  it('names the browser on the operating system, with its version when known', () => {
    expect(deviceLabel(firefoxOnWindows)).toBe('Firefox sur Windows');
    expect(
      deviceLabel({ ...firefoxOnWindows, browser: 'Safari', os: 'iOS', osVersion: '18.1' }),
    ).toBe('Safari sur iOS 18.1');
  });

  it.each<[Partial<SecurityEmailClient>, string]>([
    [{ os: null }, 'Firefox sur un ordinateur'],
    [{ os: null, deviceType: 'mobile' }, 'Firefox sur un mobile'],
    [{ os: null, deviceType: 'tablet' }, 'Firefox sur une tablette'],
    [{ os: null, deviceType: 'unknown' }, 'Firefox'],
    [{ browser: null }, 'Navigateur inconnu sur Windows'],
    [{ browser: null, osVersion: '11' }, 'Navigateur inconnu sur Windows 11'],
    [{ browser: null, os: null }, 'Ordinateur'],
    [{ browser: null, os: null, deviceType: 'mobile' }, 'Mobile'],
    [{ browser: null, os: null, deviceType: 'unknown' }, 'Appareil inconnu'],
    [{ browser: null, os: null, deviceType: 'watch' }, 'Appareil inconnu'],
  ])('says what is known when a part is unreadable: %j gives "%s"', (overrides, label) => {
    expect(deviceLabel({ ...firefoxOnWindows, ...overrides })).toBe(label);
  });
});

describe('subjectDevice', () => {
  it('names the browser and the operating system without versions', () => {
    expect(
      subjectDevice({ ...firefoxOnWindows, browser: 'Safari', os: 'iOS', osVersion: '18.1' }),
    ).toBe('Safari sur iOS');
  });

  it('is empty when the browser or the operating system is unknown, so the subject falls back', () => {
    expect(subjectDevice({ ...firefoxOnWindows, browser: null })).toBe('');
    expect(subjectDevice({ ...firefoxOnWindows, os: null })).toBe('');
  });
});

describe('closedSessionsLabel', () => {
  it('says the sessions a reset closed, never a fixed number', () => {
    expect(closedSessionsLabel('reset', 3)).toBe('vos 3 autres sessions ont été fermées');
    expect(closedSessionsLabel('reset', 5)).toBe('vos 5 autres sessions ont été fermées');
    expect(closedSessionsLabel('reset', 1)).toBe('votre autre session a été fermée');
  });

  it('closes nothing for a change from a session, nor for a reset that kept the other sessions', () => {
    expect(closedSessionsLabel('change', 0)).toBe('');
    expect(closedSessionsLabel('reset', 0)).toBe('');
  });
});
