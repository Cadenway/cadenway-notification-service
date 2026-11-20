import type { InboxCandidate } from './inbox-candidate.model.js';

/** Outcome after ownership and linkage are checked under the write lock. */
export type InboxCheckedChangeResult =
  | { readonly kind: 'not-found' }
  | { readonly kind: 'version-mismatch'; readonly currentVersion: number }
  | { readonly kind: 'ok'; readonly record: InboxCandidate };
