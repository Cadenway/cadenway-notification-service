/** Opaque occurrence and generation from the durable job. */
export interface SendActivityEmailInput {
  // #region Properties
  /** Values scoped to this operation. */
  readonly userId: string;
  readonly occurrenceId: string;
  readonly generation: number;
  // #endregion
}
