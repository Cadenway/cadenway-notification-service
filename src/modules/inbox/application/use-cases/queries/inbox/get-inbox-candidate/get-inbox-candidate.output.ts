import type { InboxSubject } from '../../../../models/inbox/inbox-subject.model.js';

/** Owned notification linkage used for the next visibility check. */
export type GetInboxCandidateOutput = {
  readonly id: string;
  readonly subject: InboxSubject;
} | null;
