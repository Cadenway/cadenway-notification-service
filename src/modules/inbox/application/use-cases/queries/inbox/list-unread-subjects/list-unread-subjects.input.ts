import type { InboxSubjectPosition } from '../../../../models/inbox/inbox-subject-position.model.js';

/** Validated unread subject scan in an optional previously observed generation. */
export interface ListUnreadSubjectsInput {
  // #region Properties
  /** Verified tenant. */
  readonly organizationId: string;

  /** Verified account. */
  readonly recipientId: string;

  /** Generation from the decoded cursor, or null for the first page. */
  readonly expectedGeneration: string | null;

  /** Subject position from the decoded cursor. */
  readonly after: InboxSubjectPosition | null;

  /** Requested number of groups, from 1 through 100. */
  readonly limit: number;
  // #endregion
}
