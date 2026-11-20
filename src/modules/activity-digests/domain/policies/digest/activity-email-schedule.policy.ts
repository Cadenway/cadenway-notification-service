import { ActivityEmailScheduleError } from '../../errors/digest/activity-email-schedule.error.js';
import type { ActivityEmailOccurrence } from '../../value-objects/digest/activity-email-occurrence.value-object.js';

const cadences = ['each', 'daily', 'weekly', 'never'] as const;
const defaultTimeZone = 'Europe/Paris';
const hourMs = 60 * 60 * 1_000;
const dayMs = 24 * hourMs;
const localDigestHour = 9;
const maximumLookaheadDays = 14;
const maximumEpochMs = 8_640_000_000_000_000;

/** Maximum candidates assigned to a single digest or an immediate planning pass. */
export const activityEmailPageSize = 100;

/**
 * Plans the earliest permitted occurrence at or after the supplied cutoff (epoch milliseconds).
 * Compte › Notifications and public `inbox.yaml` set immediate activity email, weekday digests at
 * 09:00, or Monday digests at 09:00. Security email has its own policy. The current account time
 * zone applies, with the documented Identity account default when absent.
 *
 * Replan from the desired cutoff with the latest cadence and profile. Persist a digest once per
 * account, cadence and local date. A profile revision can invalidate a queued instant without
 * creating a second occurrence for the same date. Use the source event as the identity for `each`.
 */
export function planActivityEmail(
  cadence: (typeof cadences)[number],
  notBeforeMs: number,
  profile: Readonly<{ version: number; timeZone?: string | null }>,
): ActivityEmailOccurrence | null {
  if (!cadences.includes(cadence)) throw new ActivityEmailScheduleError('invalid-cadence');
  if (cadence === 'never') return null;
  if (!isEpochMillisecond(notBeforeMs)) throw new ActivityEmailScheduleError('invalid-cutoff');
  if (!Number.isSafeInteger(profile.version) || profile.version < 1) {
    throw new ActivityEmailScheduleError('invalid-profile-version');
  }
  if (cadence === 'each') return { cadence, dueAtMs: notBeforeMs, profileVersion: profile.version };

  const timeZone = profile.timeZone ?? defaultTimeZone;
  const clock = recipientClock(timeZone);
  const localDayMs = Math.floor(wallTimeMs(clock, notBeforeMs) / dayMs) * dayMs;
  for (let offset = 0; offset <= maximumLookaheadDays; offset += 1) {
    const day = new Date(localDayMs + offset * dayMs);
    const weekday = day.getUTCDay();
    const eligible = cadence === 'weekly' ? weekday === 1 : weekday >= 1 && weekday <= 5;
    if (!eligible) continue;

    const dueAtMs = firstInstantAtNine(clock, day.getTime());
    if (dueAtMs === null || dueAtMs < notBeforeMs) continue;

    return {
      cadence,
      dueAtMs,
      localDate: day.toISOString().replace(/T.*$/u, ''),
      timeZone,
      profileVersion: profile.version,
    };
  }
  throw new ActivityEmailScheduleError('occurrence-unavailable');
}

/** Uses ICU's IANA rules and a fixed ISO calendar regardless of the process defaults. */
function recipientClock(timeZone: string): Intl.DateTimeFormat {
  if (/^[+-]/u.test(timeZone)) throw new ActivityEmailScheduleError('invalid-time-zone');
  try {
    return new Intl.DateTimeFormat('en-GB', {
      timeZone,
      calendar: 'iso8601',
      numberingSystem: 'latn',
      hourCycle: 'h23',
      era: 'short',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    });
  } catch (error: unknown) {
    if (error instanceof RangeError) throw new ActivityEmailScheduleError('invalid-time-zone');
    throw error;
  }
}

/** Represents an instant's wall clock numerically by placing its local fields on a UTC timeline. */
function wallTimeMs(clock: Intl.DateTimeFormat, instantMs: number): number {
  const parts = clock.formatToParts(instantMs);
  const field = (type: Intl.DateTimeFormatPartTypes): string | undefined =>
    parts.find((part) => part.type === type)?.value;
  const year = Number(field('year'));
  const date = new Date(0);
  date.setUTCFullYear(
    field('era') === 'BC' ? 1 - year : year,
    Number(field('month')) - 1,
    Number(field('day')),
  );
  date.setUTCHours(Number(field('hour')), Number(field('minute')), Number(field('second')));
  return date.getTime();
}

/** Checks offsets on both sides of a civil change and round-trips every candidate to 09:00. */
function firstInstantAtNine(clock: Intl.DateTimeFormat, localDayMs: number): number | null {
  const target = localDayMs + localDigestHour * hourMs;
  let first = Number.POSITIVE_INFINITY;
  for (const probe of [target - dayMs, target, target + dayMs]) {
    if (!isEpochMillisecond(probe)) continue;
    const offset = wallTimeMs(clock, probe) - probe;
    const candidate = target - offset;
    if (isEpochMillisecond(candidate) && wallTimeMs(clock, candidate) === target) {
      first = Math.min(first, candidate);
    }
  }
  // A skipped wall time has no matching instant. A repeated one has a single earliest delivery.
  return Number.isFinite(first) ? first : null;
}

/** Checks the exact millisecond range accepted by Date and Intl. */
function isEpochMillisecond(value: number): boolean {
  return Number.isSafeInteger(value) && Math.abs(value) <= maximumEpochMs;
}
