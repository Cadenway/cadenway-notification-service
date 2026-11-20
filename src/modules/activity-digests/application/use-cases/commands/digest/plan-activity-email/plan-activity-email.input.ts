/** Account to schedule and cutoff chosen by the candidate scanner. */
export interface PlanActivityEmailInput {
  // #region Properties
  /** Values scoped to this operation. */
  readonly userId: string;
  readonly notBeforeMs: number;
  // #endregion
}
