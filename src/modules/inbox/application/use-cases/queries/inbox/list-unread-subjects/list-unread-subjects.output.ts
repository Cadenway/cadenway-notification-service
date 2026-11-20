import type { InboxSubjectPosition } from '../../../../models/inbox/inbox-subject-position.model.js';
import type { InboxSubject } from '../../../../models/inbox/inbox-subject.model.js';

/** Recipient generation and exact unread subject weights. */
export interface ListUnreadSubjectsOutput {
  // #region Properties
  /** Generation shared by the returned page. */
  readonly generation: string;

  /** Bounded subject groups, including an owner-only null subject. */
  readonly items: readonly { readonly subject: InboxSubject; readonly count: number }[];

  /** Position for the next group, when one exists. */
  readonly next: InboxSubjectPosition | null;
  // #endregion
}
