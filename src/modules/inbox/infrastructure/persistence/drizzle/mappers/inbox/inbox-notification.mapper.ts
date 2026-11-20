import { InboxNotification } from '../../../../../domain/aggregates/inbox/inbox-notification.aggregate.js';
import type { inboxNotifications } from '../../schemas/inbox/inbox-notifications.schema.js';

/** Restores a persisted inbox record after narrowing its checked subject kind. */
export function toInboxNotification(
  row: typeof inboxNotifications.$inferSelect,
): InboxNotification {
  const { subjectKind, subjectValue } = row;
  if (
    (subjectKind === null) !== (subjectValue === null) ||
    (subjectKind !== null && !['task-id', 'task-key', 'space', 'list'].includes(subjectKind))
  ) {
    throw new Error('Stored inbox subject is invalid.');
  }
  let subject: { kind: 'task' | 'space' | 'list'; id: string } | null = null;
  if (subjectValue !== null) {
    if (
      subjectKind !== 'task-id' &&
      subjectKind !== 'task-key' &&
      subjectKind !== 'space' &&
      subjectKind !== 'list'
    ) {
      throw new Error('Stored inbox subject is invalid.');
    }
    subject = {
      kind: subjectKind === 'task-id' || subjectKind === 'task-key' ? 'task' : subjectKind,
      id: subjectValue,
    };
  }
  return InboxNotification.restore({
    id: row.id,
    organizationId: row.organizationId,
    recipientId: row.recipientId,
    kind: row.kind,
    actorUserId: row.actorUserId,
    subject,
    createdAt: row.createdAt.getTime(),
    readAt: row.readAt?.getTime() ?? null,
    archivedAt: row.archivedAt?.getTime() ?? null,
    version: row.version,
  });
}
