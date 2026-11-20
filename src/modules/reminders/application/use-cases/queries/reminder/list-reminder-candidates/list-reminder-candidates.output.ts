/** Candidate references and continuation position, containing no private note. */
export interface ListReminderCandidatesOutput {
  // #region Properties
  /** Generation used for this page and its cursor. */
  readonly generation: string;

  /** Candidates in schedule and identifier order. */
  readonly items: readonly {
    readonly id: string;
    readonly taskId: string;
    readonly remindAt: number;
  }[];

  /** A subsequent page may exist. */
  readonly hasMore: boolean;
  // #endregion
}
