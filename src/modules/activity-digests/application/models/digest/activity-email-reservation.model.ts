/** A persisted occurrence capable of owning candidate assignments. */
export interface ActivityEmailReservation {
  // #region Properties
  /** Stable occurrence ID and the current authorization generation. */
  readonly id: string;
  readonly generation: number;
  // #endregion
}
