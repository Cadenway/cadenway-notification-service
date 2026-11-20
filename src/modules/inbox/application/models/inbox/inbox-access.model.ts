import { InboxError } from '../../../domain/errors/inbox/inbox.error.js';
import type { InboxNotification } from '../../../domain/aggregates/inbox/inbox-notification.aggregate.js';

/** Indicates that current access cannot be determined safely. */
export class InboxVisibilityUnavailable extends Error {
  // #region Constructor
  /** Uses a non-sensitive diagnostic. */
  public constructor() {
    super('Current inbox visibility is unavailable.');
  }
  // #endregion
}

/** Reports an authorized current representation version. */
export class InboxVersionMismatch extends Error {
  // #region Constructor
  /** Retains the version for a conditional response. */
  public constructor(public readonly currentVersion: number) {
    super('Notification version does not match.');
  }
  // #endregion
}

/** Authorizes before returning a notification or revealing its version. */
export function requireInboxAccess(
  item: InboxNotification | null,
  organizationId: string,
  userId: string,
  visibility: 'visible' | 'hidden' | 'unavailable',
): InboxNotification {
  if (visibility === 'unavailable') throw new InboxVisibilityUnavailable();
  if (item === null) throw new InboxError('notification.not-found');
  item.requireAccess(organizationId, userId, visibility === 'visible');
  return item;
}
