/** The inbox changed while the gateway was establishing current visibility. */
export class InboxGenerationChanged extends Error {
  // #region Constructor
  /** Exposes a stable diagnostic for the internal conflict response. */
  public constructor() {
    super('The inbox changed during its scan.');
    this.name = 'InboxGenerationChanged';
  }
  // #endregion
}
