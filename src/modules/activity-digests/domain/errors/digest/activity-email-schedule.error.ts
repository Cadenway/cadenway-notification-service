/** Base class for refusals in the activity digest domain. */
abstract class DomainError extends Error {}

type ScheduleErrorCode =
  | 'invalid-cadence'
  | 'invalid-cutoff'
  | 'invalid-profile-version'
  | 'invalid-time-zone'
  | 'occurrence-unavailable';

const messages: Readonly<Record<ScheduleErrorCode, string>> = {
  'invalid-cadence': 'The activity email cadence is invalid.',
  'invalid-cutoff': 'The activity email scheduling cutoff is invalid.',
  'invalid-profile-version': 'The notification recipient profile version is invalid.',
  'invalid-time-zone': 'The notification recipient time zone is invalid.',
  'occurrence-unavailable': 'No activity digest occurrence could be scheduled.',
};

/** A scheduling refusal that leaves account data and dates out of its message. */
export class ActivityEmailScheduleError extends DomainError {
  // #region Constructor
  /** Identifies which scheduling invariant was refused. */
  public constructor(public readonly code: ScheduleErrorCode) {
    super(messages[code]);
    this.name = 'ActivityEmailScheduleError';
  }
  // #endregion
}
