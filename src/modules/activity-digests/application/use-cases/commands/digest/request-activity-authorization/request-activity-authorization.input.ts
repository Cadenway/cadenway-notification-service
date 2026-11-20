/** Opaque occurrence job identity and exclusive authorization deadline. */
export interface RequestActivityAuthorizationInput {
  // #region Properties
  /** Values scoped to this operation. */
  readonly organizationId: string;
  readonly userId: string;
  readonly occurrenceId: string;
  readonly generation: number;
  readonly expiresAt: number;
  // #endregion
}
