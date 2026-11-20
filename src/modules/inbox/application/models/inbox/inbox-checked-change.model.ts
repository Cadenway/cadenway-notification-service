import type { InboxSubject } from './inbox-subject.model.js';

/** A checked notification mutation within the caller's inbox. */
export interface InboxCheckedChange {
  // #region Properties
  /** Verified tenant. */
  readonly organizationId: string;

  /** Verified account. */
  readonly recipientId: string;

  /** Owned notification identity. */
  readonly notificationId: string;

  /** The exact persisted selector that Gateway authorized. */
  readonly subject: InboxSubject;

  /** Parsed If-Match validators or wildcard, when supplied. */
  readonly expectedVersions?: readonly number[] | '*' | undefined;
  // #endregion
}
