import { describe, expect, it } from 'vitest';

import { ActivityEmailScheduleError } from '../../errors/digest/activity-email-schedule.error.js';
import { planActivityEmail } from './activity-email-schedule.policy.js';

const paris = { timeZone: 'Europe/Paris', version: 3 } as const;

describe('activity email scheduling', () => {
  it('plans each eligible event immediately and skips disabled activity email', () => {
    const notBeforeMs = Date.parse('2026-03-27T12:00:00Z');

    expect(planActivityEmail('each', notBeforeMs, paris)).toEqual({
      cadence: 'each',
      dueAtMs: notBeforeMs,
      profileVersion: 3,
    });
    expect(planActivityEmail('never', notBeforeMs, paris)).toBeNull();
  });

  it('uses the recipient local weekday and includes the exact cutoff', () => {
    expect(planActivityEmail('daily', Date.parse('2026-03-27T08:00:00Z'), paris)).toEqual({
      cadence: 'daily',
      dueAtMs: Date.parse('2026-03-27T08:00:00Z'),
      localDate: '2026-03-27',
      timeZone: 'Europe/Paris',
      profileVersion: 3,
    });
    expect(planActivityEmail('daily', Date.parse('2026-03-27T08:00:00.001Z'), paris)).toMatchObject(
      {
        dueAtMs: Date.parse('2026-03-30T07:00:00Z'),
        localDate: '2026-03-30',
      },
    );
  });

  it('waits until Monday for weekly delivery and advances past a delivered cutoff', () => {
    const monday = Date.parse('2026-10-26T08:00:00Z');

    expect(planActivityEmail('weekly', Date.parse('2026-10-23T08:00:00Z'), paris)).toMatchObject({
      cadence: 'weekly',
      dueAtMs: monday,
      localDate: '2026-10-26',
    });
    expect(planActivityEmail('weekly', monday, paris)).toMatchObject({ dueAtMs: monday });
    expect(planActivityEmail('weekly', monday + 1, paris)).toMatchObject({
      dueAtMs: Date.parse('2026-11-02T08:00:00Z'),
      localDate: '2026-11-02',
    });
  });

  it('skips an IANA calendar date omitted by a civil time change', () => {
    expect(
      planActivityEmail('daily', Date.parse('2011-12-29T21:00:00Z'), {
        timeZone: 'Pacific/Apia',
        version: 1,
      }),
    ).toMatchObject({
      dueAtMs: Date.parse('2012-01-01T19:00:00Z'),
      localDate: '2012-01-02',
    });
  });

  it('recomputes the due instant and keeps the occurrence date stable when the profile changes', () => {
    const notBeforeMs = Date.parse('2026-03-30T00:00:00Z');

    expect(planActivityEmail('daily', notBeforeMs, paris)).toMatchObject({
      dueAtMs: Date.parse('2026-03-30T07:00:00Z'),
      localDate: '2026-03-30',
      profileVersion: 3,
    });
    expect(
      planActivityEmail('daily', notBeforeMs, { timeZone: 'America/New_York', version: 4 }),
    ).toMatchObject({
      dueAtMs: Date.parse('2026-03-30T13:00:00Z'),
      localDate: '2026-03-30',
      profileVersion: 4,
      timeZone: 'America/New_York',
    });
  });

  it('uses the documented default when the account has no selected zone', () => {
    const notBeforeMs = Date.parse('2026-03-30T06:00:00Z');

    expect(planActivityEmail('daily', notBeforeMs, { version: 3 })).toEqual(
      planActivityEmail('daily', notBeforeMs, paris),
    );
    expect(planActivityEmail('daily', notBeforeMs, { version: 3, timeZone: null })).toEqual(
      planActivityEmail('daily', notBeforeMs, paris),
    );
  });

  it.each(['Mars/Olympus', '+01:00', ''])('refuses a non-IANA scheduling zone %s', (timeZone) => {
    expect(() =>
      planActivityEmail('daily', Date.parse('2026-03-30T00:00:00Z'), {
        timeZone,
        version: 3,
      }),
    ).toThrow(ActivityEmailScheduleError);
  });

  it('refuses an invalid cutoff or profile revision without quoting the input', () => {
    expect(() => planActivityEmail('daily', Number.NaN, paris)).toThrow(ActivityEmailScheduleError);
    expect(() => planActivityEmail('each', 0, { version: 0 })).toThrow(ActivityEmailScheduleError);
  });
});
