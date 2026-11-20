/** Base class for the rules enforced by the reminders domain. */
abstract class DomainError extends Error {}

type ReminderErrorCode =
  | 'reminder.not-found'
  | 'reminder.date-not-in-future'
  | 'reminder.already-completed'
  | 'invalid-reminder';

const messages: Readonly<Record<ReminderErrorCode, string>> = {
  'reminder.not-found': 'Reminder not found.',
  'reminder.date-not-in-future': 'A new reminder time must be in the future.',
  'reminder.already-completed': 'A completed reminder cannot be changed.',
  'invalid-reminder': 'Invalid reminder.',
};

/** A reminder refusal whose message does not contain ownership, dates or the private note. */
export class ReminderError extends DomainError {
  // #region Properties
  /** The rule that produced the error. */
  public readonly code: ReminderErrorCode;
  // #endregion

  // #region Constructor
  /** Builds a refusal without quoting its source data. */
  public constructor(code: ReminderErrorCode) {
    super(messages[code]);
    this.name = 'ReminderError';
    this.code = code;
  }
  // #endregion
}
