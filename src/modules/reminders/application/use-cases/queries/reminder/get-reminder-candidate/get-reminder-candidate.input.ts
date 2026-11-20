/** Owner scope and identifier for a private task-link lookup. */
export interface GetReminderCandidateInput {
  // #region Properties
  /** Organization from the verified context. */
  readonly organizationId: string;

  /** Account from the verified actor. */
  readonly userId: string;

  /** Reminder identifier. */
  readonly id: string;
  // #endregion
}
