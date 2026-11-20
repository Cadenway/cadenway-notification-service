import { InboxError } from '../../errors/inbox/inbox.error.js';
import type { NotificationCreated } from '../../events/inbox/notification-created.event.js';
import type { InboxNotificationSnapshot } from '../../value-objects/inbox/inbox-notification-snapshot.value-object.js';

type NewNotification = Omit<InboxNotificationSnapshot, 'readAt' | 'archivedAt' | 'version'>;

/** Recipient inbox state and idempotent transitions from the P4 Inbox contract. */
export class InboxNotification {
  // #region Properties
  /** The immutable record. Applications must check access before projecting it to a caller. */
  public readonly snapshot: InboxNotificationSnapshot;

  /** Archived records leave the unread badge even when they have no read timestamp. */
  public get isUnread(): boolean {
    return this.snapshot.readAt === null && this.snapshot.archivedAt === null;
  }
  // #endregion

  // #region Constructor
  /** Checks chronology and keeps an immutable copy of the record. */
  private constructor(snapshot: InboxNotificationSnapshot) {
    if (
      ![snapshot.id, snapshot.organizationId, snapshot.recipientId, snapshot.kind].every(
        (value) => value.trim() !== '',
      ) ||
      snapshot.actorUserId?.trim() === '' ||
      snapshot.subject?.id.trim() === '' ||
      !Number.isSafeInteger(snapshot.version) ||
      snapshot.version < 1 ||
      !isInstant(snapshot.createdAt) ||
      [snapshot.readAt, snapshot.archivedAt].some(
        (instant) => instant !== null && (!isInstant(instant) || instant < snapshot.createdAt),
      )
    ) {
      throw new InboxError('invalid-notification');
    }
    this.snapshot = Object.freeze({
      ...snapshot,
      subject: snapshot.subject === null ? null : Object.freeze({ ...snapshot.subject }),
    });
  }
  // #endregion

  // #region Methods
  /** Creates an unread, active notification and the fact for its recipient. */
  public static create(input: NewNotification): {
    readonly notification: InboxNotification;
    readonly fact: NotificationCreated;
  } {
    const notification = new InboxNotification({
      ...input,
      readAt: null,
      archivedAt: null,
      version: 1,
    });
    return {
      notification,
      fact: {
        notificationId: input.id,
        organizationId: input.organizationId,
        recipientId: input.recipientId,
        createdAt: input.createdAt,
      },
    };
  }

  /** Reconstitutes a notification already persisted by the inbox. */
  public static restore(snapshot: InboxNotificationSnapshot): InboxNotification {
    return new InboxNotification(snapshot);
  }

  /**
   * Applies the Inbox contract's single concealed refusal. The application resolves visibility
   * against the current subject policy, with an indeterminate decision treated as unreadable.
   */
  public requireAccess(organizationId: string, recipientId: string, subjectVisible: boolean): void {
    if (
      organizationId !== this.snapshot.organizationId ||
      recipientId !== this.snapshot.recipientId ||
      (this.snapshot.subject !== null && !subjectVisible)
    ) {
      throw new InboxError('notification.not-found');
    }
  }

  /** Sets the first read timestamp after the application checks access and the precondition. */
  public markRead(now: number): InboxNotification {
    return this.snapshot.readAt === null
      ? new InboxNotification({ ...this.snapshot, readAt: now, version: this.snapshot.version + 1 })
      : this;
  }

  /** Archives once without changing the read timestamp. */
  public archive(now: number): InboxNotification {
    return this.snapshot.archivedAt === null
      ? new InboxNotification({
          ...this.snapshot,
          archivedAt: now,
          version: this.snapshot.version + 1,
        })
      : this;
  }
  // #endregion
}

/** Identifies an integral timestamp inside the runtime's UTC date range. */
function isInstant(value: number): boolean {
  return Number.isSafeInteger(value) && Math.abs(value) <= 8_640_000_000_000_000;
}
