/** Selected exact task references checked by the gateway. */
export interface ListSelectedRemindersInput {
  // #region Properties
  /** Organization from the verified context. */
  readonly organizationId: string;

  /** Account from the verified actor. */
  readonly userId: string;

  /** Owner generation sampled during the candidate scan. */
  readonly expectedGeneration: string;

  /** Authorized exact reminder and task pairs in response order. */
  readonly pairs: readonly { readonly id: string; readonly taskId: string }[];
  // #endregion
}
