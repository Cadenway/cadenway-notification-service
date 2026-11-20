import { ReminderError } from '../../../domain/errors/reminder/reminder.error.js';
import { ReminderVersionMismatch } from './reminder-access.model.js';

/** A known application refusal suitable for mapping to an internal HTTP problem. */
export type ReminderRefusal =
  | { readonly code: 'reminder.not-found'; readonly status: 404 }
  | { readonly code: 'reminder.date-not-in-future'; readonly status: 422 }
  | { readonly code: 'reminder.already-completed'; readonly status: 409 }
  | {
      readonly code: 'request.version-mismatch';
      readonly status: 412;
      readonly currentVersion: number | null;
    };

/** Returns a known refusal without exposing the reminder's contents. */
export function reminderRefusal(error: unknown): ReminderRefusal | null {
  if (error instanceof ReminderVersionMismatch) {
    return { code: 'request.version-mismatch', status: 412, currentVersion: error.currentVersion };
  }
  if (!(error instanceof ReminderError)) return null;
  switch (error.code) {
    case 'reminder.not-found':
      return { code: error.code, status: 404 };
    case 'reminder.date-not-in-future':
      return { code: error.code, status: 422 };
    case 'reminder.already-completed':
      return { code: error.code, status: 409 };
    default:
      return null;
  }
}
