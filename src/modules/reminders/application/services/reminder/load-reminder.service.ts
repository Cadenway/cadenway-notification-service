import type { Reminder } from '../../../domain/aggregates/reminder/reminder.aggregate.js';
import { requireReminderAccess } from '../../models/reminder/reminder-access.model.js';
import type { ReminderStore } from '../../ports/outbound/transactions/reminder/reminder-store.port.js';

/** Loads and authorizes one reminder before exposing its version or contents. */
export async function loadReminder(
  store: ReminderStore,
  organizationId: string,
  userId: string,
  id: string,
  authorizedTaskId: string,
  lock: boolean,
): Promise<Reminder> {
  const reminder = await store.findById(organizationId, userId, id, lock);
  if (reminder === null) return requireReminderAccess(null, organizationId, userId, 'hidden');
  const matches = reminder.snapshot.taskId.toLowerCase() === authorizedTaskId.toLowerCase();
  return requireReminderAccess(reminder, organizationId, userId, matches ? 'visible' : 'hidden');
}
