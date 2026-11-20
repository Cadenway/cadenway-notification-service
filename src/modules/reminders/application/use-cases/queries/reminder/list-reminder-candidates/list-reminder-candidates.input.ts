/** Owner and continuation position already decoded from the signed private cursor. */
export interface ListReminderCandidatesInput {
  // #region Properties
  /** Organization from the verified context. */
  readonly organizationId: string;

  /** Account from the verified actor. */
  readonly userId: string;

  /** Generation from a continuation cursor, or null for the first page. */
  readonly expectedGeneration: string | null;

  /** Last consumed candidate position, or null for the first page. */
  readonly after: { readonly remindAt: number; readonly id: string } | null;

  /** Maximum number of candidate records requested. */
  readonly limit: number;
  // #endregion
}
