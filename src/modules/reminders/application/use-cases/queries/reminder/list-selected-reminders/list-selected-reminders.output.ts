import type { ReminderSnapshot } from '../../../../../domain/value-objects/reminder/reminder-snapshot.value-object.js';

/** Matching private reminders, in request order. */
export type ListSelectedRemindersOutput = readonly ReminderSnapshot[];
